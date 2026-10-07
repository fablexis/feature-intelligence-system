# Tasks

**Status:** tasks (phase 3 of spec → plan → tasks → implementation)
**Upstream:** [`PRODUCT.md`](./PRODUCT.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`adr/`](./adr)

IDs match the [PRODUCT appetite table](./PRODUCT.md#must-have-core). **Actual / Status / Deviation are filled in during implementation**, not now — they are the honest record of where the plan was wrong.

**Budget: 180 min core.** Time is fixed, scope flexes via the [cut order](#cut-order).

---

## Execution Order

**C1 → C6 → C2 → C3 → C7 → C4 → C5 → C8**

Three non-obvious reasons:

1. **C6 (seed corpus) before C2 (provider + record script).** The record script records model outputs *against the corpus*, so the corpus and its labels must exist first. Reversing these means recording twice.
2. **C7 (eval) immediately after C3 (pipeline), before any more UI.** Thresholds are chosen from the eval curve, and C5's priority demo is only meaningful once dedupe is calibrated. An early eval also catches a broken extractor before UI work is built on top of it. C3 ships reading thresholds from `config/thresholds.json`; C7 chooses the values; **C3 needs no code change** — which is why thresholds are config, not constants. *(Held: C7 changed no pipeline code. It did find that one of the two thresholds it was asked to sweep has no implementation and should not get one — see C7's Deviation.)*
3. **C4 and C5 last among features** because they are the most cuttable, and **C8 last** so the README reflects what actually shipped.

---

## Core

### C1 — Project skeleton · 25 min
**Goal:** a running Next.js app with a migrated database and the UI kit in place.
**Depends on:** —

- [x] `next dev` serves a page with no console errors — HTTP 200, clean dev log, `next build` prerenders it
- [x] Drizzle schema covers all 10 tables from [ARCHITECTURE](./ARCHITECTURE.md#data-model); `migrate` runs clean on an empty file
- [x] Tailwind + shadcn/ui render one styled component — Card/Badge/Button on `/`
- [x] `.env.example` lists all four model/dim vars with no real key committed
- [x] `tsc --noEmit` passes — plus `lint` clean and 4/4 Vitest tests green

**Actual:** ~10 min (est. 25) · **Status:** Done · **Deviation:**
- **SQLite driver: `better-sqlite3`, not `node:sqlite`.** ARCHITECTURE.md named no driver. `node:sqlite` would avoid a native module, but Drizzle only supports it in `drizzle-orm@1.0.0-rc.4`; stable is `0.45.3`. An RC ORM is a worse risk in a fixed-time build than a native module with working prebuilds (verified loading on Node 24 / darwin-arm64).
- **Added `tsx`** as the script runner. Node 24's native type stripping cannot resolve extensionless relative imports, and adding `.ts` extensions throughout fights Next's resolver.
- **Bumped `@types/node` 20 → 24.** The scaffold pinned `^20` while the runtime is Node 24; Vitest 5 requires `^22 || >=24`. The types should match the runtime regardless.
- **Four schema fields added beyond ARCHITECTURE.md**, now documented there: `problems.embedding_model`, `ai_decisions.request_id`/`problem_id`, `dedupe_suggestions.verdict_confidence`, and `unsure` on `human_action`. Each is a consequence of an ADR that the data-model table had not yet absorbed.
- **9 npm audit findings left unfixed** (5 high, 4 moderate), all dev-tooling-only: `braces`/`micromatch`/`fast-glob` via `eslint-config-next`, and `esbuild` via `drizzle-kit`'s deprecated `@esbuild-kit/*` chain. No non-breaking fix exists — the `braces` advisory covers all of 3.x, and npm's only remedies are major *downgrades* (`eslint-config-next` 16→14, `drizzle-kit` 0.31→0.18). Neither is reachable from app runtime or from mock-mode CI. Revisit in [E3](#e3--review--hardening).
- Faster than estimated because scaffolding is largely generated; the time went to dependency resolution, not to writing code.

### C2 — Provider abstraction + record/replay · 35 min
**Goal:** all four model capabilities behind one interface, usable with or without a key.
**Depends on:** C1, C6 · **ADR:** [0001](./adr/0001-llm-provider.md), [0004](./adr/0004-record-replay-provider.md)

- [x] `AiProvider` interface: `extractProblem`, `embed`, `adjudicate`, `estimateFactors`
- [x] Gemini implementation uses `generateObject` with Zod schemas for every non-embedding call
- [x] `npm run record` populates `fixtures/` for the whole seed corpus + scripted demo request — 56 extractions + 56 embeddings; `npm run verify:replay` confirms **56/56 real, 0 degraded, deterministic**
- [x] Replay provider resolves a recorded input by hash and returns the identical object twice in a row
- [x] Unrecorded input falls back to n-grams and sets `degraded: true`
- [x] Every call writes one `ai_decisions` row with stage, model ID, latency and token usage
- [x] Model IDs are read from env; `grep -rn "gemini-[0-9]" src/ scripts/` returns nothing
- [x] **Record script is quota-safe:** throttled, retries 429/5xx with exponential backoff, and **resumable** — re-running skips inputs already recorded by hash
- [x] **`--dry-run` prints the expected call count per stage** before any quota is spent

**Actual:** ~52 min (est. 35) · **Status:** Done · **Deviation:**
- **Overran the estimate by ~17 min, almost entirely on quota archaeology.** The code was done in ~8 min; the rest was discovering the free tier's real shape and fixing what that exposed. Worth the overrun — the findings reshaped ADR 0001, ADR 0002 and the C3/C5 budget.
- **The free tier caps `generate_content` at 20 requests/day/model** (measured — the error stated the number), not per minute. `gemini-3.8-flash` was exhausted after 7 extractions with a 19h21m retry-after. Full account in the [ADR 0001 amendment](./adr/0001-llm-provider.md). Fast tier moved to `gemini-3.1-flash-lite`, probed before committing; it then served 57 calls without a cut-off.
- **Nested retries were a quota amplifier.** The AI SDK retries internally (3 attempts) and the record loop retried on top (4) — up to 12 real calls per logical call, which is how 7 extractions burned a 20-call budget. SDK retries disabled at all four call sites; retrying lives in one place.
- **A quota 429 was misclassified as transient.** `src/ai/errors.ts` now classifies on the **retry-after duration, not the status code** — the useful question is whether it clears in seconds or hours — and aborts above 120s instead of backing off pointlessly.
- **Two bugs the verification caught, which is the point of having it.** (1) The embed phase derived its work from *this run's* extractions, so a run that died before embedding left 22 extractions permanently unembedded; it now derives from the whole fixture store and is correct across resumes. (2) `verify-replay.ts` passed an extra `id` field into `extractProblem`, changing the input hash and reporting 0/56 instead of 34/56 — my bug in the verifier, not the pipeline.
- **Per-stage models added** (`GEMINI_MODEL_ADJUDICATE`, `GEMINI_MODEL_SCORE`) so no two `generate_content` stages share a daily cap. `renderBudget()` **verifies** that isolation rather than asserting it — and immediately caught both stages falling back to `MODEL_STRONG`.
- **My dry-run time estimate was wrong by ~7×**: it counted throttle gaps only, while real calls take 19–23s and latency dominates. Now reports both components.
- **Measured finding that changes a design decision:** duplicates and adjacent problems **overlap in cosine space** (worst duplicate 0.741 < best non-duplicate 0.772). No similarity threshold separates them, so problem formation cannot be threshold-driven — see [eval-results](./eval-results.md) and the [ADR 0002 amendment](./adr/0002-two-stage-dedupe.md).
- `generateObject` is deprecated in AI SDK 7 in favour of `generateText` with an output setting. Left as-is since C2's criteria name it; flagged for [E3](#e3--review--hardening).
- Fixtures are 608 KB (`outputs.json`) — comfortable for git at 768 dims.
- **Adjudication and factor fixtures cannot be recorded yet — confirmed, not assumed.** Adjudication's input is `(draft, retrieved candidates)`, and which candidates exist depends on which problems have been formed by the time each request arrives — i.e. on ingest order and on prior merge decisions, which need C3's pipeline and C7's thresholds. `estimateFactors` likewise needs formed problems with evidence sets. So this task records **extract + embed** (the two stateless stages), and `fixtures/manifest.json` carries a `pending` block naming both deferred stages and why. Record them immediately after C3.
- **Embedding space is now a first-class type.** n-gram and Gemini vectors are not merely different in quality — cosine between them is **meaningless**, because they share no geometry. So `EmbedOutput` carries `space: 'gemini' | 'ngram'`, `problems.embedding_model` persists it, and **C3's retrieval must compare only within one space**. Without this the degraded path would return confident nonsense instead of honest misses.
- **`EMBED_DIM` 768, not 3072**, requested via `outputDimensionality`. A quarter the fixture bytes, ample discrimination at a 12-problem scale, and embeddings are stored rounded to 6dp — far below cosine's sensitivity.
- **Embeddings are batched** (`embedMany`, 16 per call), cutting the embed stage from 56 API calls to 4 — total 60 instead of 112. With unpublished free-tier limits that is the difference between a comfortable record run and an unknown risk.
- **Env var is `GOOGLE_GENERATIVE_AI_API_KEY`**, which is what the AI SDK's Google provider reads by default, so the app never handles the value. `.env.example` had the wrong name (`GEMINI_API_KEY`) and was corrected. `requireGeminiConfig()` reports missing env **by name only**, asserted by a test.
- **Prompt version is a content hash** (`v1-<sha8>` of the prompt file), so editing a prompt in `/prompts` automatically invalidates every fixture that depended on it. Staleness cannot be forgotten rather than merely being documented.
- **`scripts/record.ts` wraps its body in `main()`.** tsx compiles to CJS (no `"type": "module"`), which rejects top-level await. A `.mts` rename would also work but makes the script's module format load-bearing.
- **Fixtures hold model output only** — `{key, stage, output, tokens}` and nothing else. Three tests guard it: no Google API-key shape, no auth/api-key field names, and no keys beyond that whitelist.

### C3 — Intake pipeline + three-way resolution · 40 min
**Goal:** the centerpiece. Submit → extract → embed → retrieve → adjudicate → resolve, in one interaction.
**Depends on:** C2 · **ADR:** [0002](./adr/0002-two-stage-dedupe.md), [0005](./adr/0005-duplicate-resolution-actor.md)

- [x] Stages 1–5 run in order with per-stage timing recorded
- [x] **A planted near-duplicate in disjoint vocabulary is matched to its problem** — 6 of 11, including the hardest (`r06a/r06b`, cosine 0.741, *below* the best non-duplicate, so unreachable by cosine alone)
- [x] Each of the three outcomes is reachable: auto-attach (16), ask-human (8), create-new (31) — all observed in the live pass
- [x] `related` is stored in `problem_links`, distinct from an evidence attach
- [x] "Actually, mine is different" creates a new problem and records the disagreement — `POST /api/intake/split`, deactivates rather than deletes, writes `human_overrides` + `rejected` on the suggestion
- [x] Every suggestion writes a `dedupe_suggestions` row **including rejected ones** — 991 tuples stored
- [x] Each stage's fallback is exercised by a forced-failure test; resolution never merges on failure — 8 tests in `fallback.test.ts`
- [x] UI shows stage-by-stage progress, not one spinner — NDJSON stream, each stage rendered on arrival
- [x] `body_raw` is stored verbatim and rendered escaped
- [x] **Adjudication is skipped when no candidate clears the recall floor** — see Deviation: with no similarity floor, only the first request qualifies, so the saving is 1 call rather than 12
- [x] Retrieval compares **only within one embedding space** ([C2](#c2--provider-abstraction--recordreplay--35-min)) — 6 dedicated tests
- [x] `npm run record` gains `--stage` — see Deviation: adjudication is recorded by `ingest`, not `record`, so `--stage` covers extract/embed and rejects `adjudicate` with a pointer to the right command
- [x] Adjudication fixtures recorded — 52 calls, replay reproduces the pass with 0 degraded

**Actual:** ~115 min of working time (est. 40), including one eval-driven prompt iteration and two ~20-min unattended recording runs; `prompts.txt` timestamps are the source of truth · **Status:** Done · **Deviation:**
- **Precision target met, recall target missed.** Pairwise against the labels: auto-band precision **1.000** (zero false merges where no human would be asked), all-band 0.974, but recall **0.319** against a pre-registered ≥0.60. 31 problems formed where ground truth is 12. Full numbers and the diagnosis in [eval-results](./eval-results.md).
- **Cause is diagnosed, not guessed:** all five missed planted pairs returned `related` at confidence 0.85, splitting on *scope* ("broader", "specifically", "rather than"). Two clauses in `prompts/adjudicate.md` are responsible — the "when torn, answer `related`" tie-break, and `related`'s "same cause, different scope" definition, where **scope is a loophole** because every paraphrase differs in scope at some level of description.
- **Recall is not recoverable by C7's sweep.** This is the flip side of formation-by-verdict that neither the plan nor I called out in advance: because `T_auto` only moves items between the auto and flagged bands, formation — and therefore recall — is frozen by the recorded verdicts. The sweep trades auto-precision against review load and nothing else. Fixing recall requires a prompt edit, which changes the prompt's content hash and invalidates all 52 adjudication fixtures. Held for a decision rather than silently re-spending quota.
- **The recall-floor skip saves 1 call, not 12.** With `minSimilarity: 0` and all problems retrieved, only the genuinely empty corpus skips. The earlier ~44 estimate assumed a floor that the exact-sweep design removed; actual spend was 52.
- **`--stage=adjudicate` does not belong on `record`.** Adjudication needs the pipeline, so `npm run ingest` records it. `record --stage` covers the two stateless stages and rejects `adjudicate` with a pointer to `ingest`.
- **Problem ids are derived (`prob-<requestId>`), not generated.** An adjudication input embeds candidate problem ids, so random ids would change every fixture key on replay and miss 100% of recorded verdicts.
- **`next build` caught two prerender bugs `next dev` did not.** Both DB-backed pages were being prerendered under Next 16's Cache Components, which would bake the account list and evidence at build time; both are now `instant = false`.
- **Deduplicated the retry policy.** `record.ts` had its own copy of `withRetry`, defeating the point of the shared module created to stop the policy drifting between scripts.
- Added `evidence_links.needs_review`, stored rather than derived from `confidence < T_auto`, because T_auto changes when the eval re-runs and history must not change with it.
- **v2: the eval-driven loop closed, and the fix improved both metrics.** The eval found a prompt defect, two clauses changed, 54 calls re-recorded. all-band precision 0.974 → **1.000**, recall 0.319 → **0.466** (+46%), problems 31 → **23** (truth 12), planted pairs 6/11 → **8/11**, and the counter-risk went the right way: v1's one false merge is **gone** and all three related-but-distinct pairs stayed distinct. Precision and recall moving together is the signal that the v1 prompt was not being cautious but inaccurate. Full before/after in [eval-results](./eval-results.md).
- **Shipped with recall 0.466 against its ≥0.60 target — a recorded known gap, not a silent miss.** Three planted pairs remain missed. Deliberately not iterated further: the asymmetry runs the other way for recall, since a missed duplicate is a *false split* that a human sees and fixes later, while a false merge is invisible and corrupts every downstream score. This build protects the expensive side completely — auto-band precision 1.000, zero false merges corpus-wide. Diagnosis, justification and the next lever are in [eval-results](./eval-results.md), marked *next with more time*.
- **The next lever is extraction, not adjudication, and it is expensive.** v2's adjudication prompt now applies the causal test correctly on 8 of 11 pairs; the remaining misses arrive already split, because their *extracted statements* sit at different zoom levels before adjudication sees them. Tightening `prompts/extract.md` would invalidate all 56 extractions, all 56 embeddings (they key on extracted text) and all 109 adjudications — ~165 fixtures against a cap still unmeasured on two of three models. Out of appetite.
- **Corrected DEMO.md to the formed problem set.** It claimed 12 problems and a 9-vs-3 account contrast; the pipeline forms 23, and notification scoping fragments across 4 problems (4+2+2+1 accounts), so the demo script would not have matched what a reviewer sees. Beat 2 now uses the real numbers (4 accounts/$79k vs 3/$1.57M — still 20× the ARR, still the only one touching a company goal) and states plainly that the pipeline *understates* that problem's reach. The recall gap is therefore not only a metric miss: it weakens the demo's second beat, which is the honest reason to record it as a known gap rather than a footnote.
- **v1 adjudication fixtures are kept on disk** (109 adjudication entries total, 54 v1 + 54 v2 + 1 demo). Reverting the prompt would then cost zero quota. Staleness is by key, so stale entries are inert.
- **Added `npm run record:demo`.** The demo request is typed live, so `ingest` never touches it and its adjudication was unfixtured — the one moment the Loom rests on would have degraded to n-grams. Recordable ahead of time because an adjudication key is `(draft, candidates)` and excludes the request id, and it mutates no state.
- **Demo request verified end-to-end on the keyless path:** auto-attaches to the correct problem at confidence 0.99 / score 0.822, 1 `same` out of 23 candidates, zero shared content words.
- Prompt versions are rendered `v1-<hash>`, where `v1` is the *scheme* version and the hash is the content. Misleading to read as "prompt v1"; renaming the prefix would invalidate the extract fixtures too, so flagged for [E3](#e3--review--hardening) rather than changed.

### Recording budget (C3 + C5)

Quota is the scarce resource in this build — not time, not money. The free tier
caps `generate_content` at a small number of requests **per day, per model**
(20/day measured; [ADR 0001 amendment](./adr/0001-llm-provider.md)). Printed by
`npm run record -- --dry-run`, computed in `src/ai/budget.ts`:

| stage | model | expected calls | daily cap | basis |
|---|---|---|---|---|
| extract | `gemini-3.1-flash-lite` | 56 *(done)* | ≥57/day | **measured lower bound** — 57 served today without a cut-off |
| embed | `gemini-embedding-001` | 4 *(done)* | separate metric | unknown — `embed_content` is not the `generate_content` bucket |
| adjudicate | `gemini-3.5-flash-lite` | ~44 | unknown | probe-confirmed available |
| factors | `gemini-3.8-flash` | 3 | 20/day | **measured** — the error stated the number |

Three levers, in order of leverage:

1. **Don't call when the answer is known.** The first request of each problem
   has nothing above the recall floor to compare against, so adjudication is
   skipped: 56 → ~44 calls. The skip is still logged, so M1's denominator stays
   honest.
2. **Batch only where batching cannot corrupt what we measure.** Factor scoring
   batches 4 problems per call (12 → 3). Safe because the eval measures
   *dedupe*, not scores. **Extraction is deliberately NOT batched** for the
   opposite reason: a model seeing several requests at once could normalise
   their statements toward each other, manufacturing the very similarity the
   dedupe eval exists to measure. That would invalidate the thesis test, so the
   56 independent calls stand.
3. **One bucket per stage.** `GEMINI_MODEL_ADJUDICATE` and
   `GEMINI_MODEL_SCORE` split the old single strong tier, so no two
   `generate_content` stages compete for one cap. `renderBudget()` **verifies**
   this rather than claiming it, and warns when two stages collide — which it
   caught immediately, since both initially fell back to `MODEL_STRONG`.

Caps are labelled by how they were learned: **measured** (an error stated the
number), **lower bound** (N calls served without a cut-off), or **unknown**.
Nothing is inferred from documentation, which does not publish them.

**Residual risk:** `gemini-3.5-flash-lite`'s cap is unknown, and adjudication is
the largest consumer at ~44 calls. If its cap is also 20, recording stalls
mid-way — which is survivable, because fixtures checkpoint per call and a
re-run resumes. Fallback order if it stalls: wait for the daily reset, or move
adjudication to whichever bucket has measured headroom. Recording across two
days is acceptable; fixtures are committed.

**Batching caveat to record now:** batched factor scores are mildly
batch-influenced — the model sees four problems at once. For a *ranking* task
that is arguably desirable, but it must be deterministic, so batch composition
is fixed by sorting on problem id, and fixtures stay keyed **per problem** (not
per batch) so adding a 13th problem does not invalidate the other twelve.

### C4 — Problem detail · 20 min
**Goal:** a problem is legible as accumulated evidence, not as an abstraction.
**Depends on:** C3

- [x] Canonical statement + the three schema fields render — verified in the rendered HTML of the production build
- [x] Every active evidence item shows its **verbatim original text** and account — plus `internal · no account` where there is none, since an unattributed note is invisible to evidence strength and that should be legible rather than blank
- [x] Evidence strength = distinct account count (per [ARCHITECTURE](./ARCHITECTURE.md#data-model)) — one definition in `src/problems/evidence.ts`, read by the list, the detail page and C5; a test asserts a 10⁶× ARR change moves it by zero
- [x] "This affects us too" is one click, idempotent per account — verified end to end against the production server with no client JS: first POST `support-added`, second `support-duplicate`, one row written, strength 4 → 5
- [x] Un-merge flips `evidence_links.active` and the request reappears intact — verified end to end: `active` 1 → 0, `body_raw` untouched, suggestion marked `rejected`, override appended, request re-listed as detached and re-attachable

**Actual:** ~11 min (est. 20) · **Status:** Done · **Deviation:**
- **Found and fixed a defect C4 created on its first click: `resetDerived` could not run once anyone used "this affects us too".** `supports` references `problems`, so deleting the problem set failed with `FOREIGN KEY constraint failed` and `npm run ingest` became permanently unrunnable. It had been latent since C3 — nothing ever wrote a support row before this screen existed — and surfaced immediately when the end-to-end check clicked the button. `resetDerived` now clears `supports` and **returns the count it discarded**, which `ingest` prints: a support row is a human's vote, and carrying it across a rebuild would re-point it at a problem that may never be re-formed, which is precisely the error this product exists to avoid. Deleting it is right; doing it silently was not. Four regression tests in `src/pipeline/reset.test.ts`.
- **`next build` caught a prerender bug again, and `instant = false` was not the fix.** `/problems` came out as `○ (Static)` with the real problem statements baked into `.next/server/app/problems.html` — the list would have been frozen at build time. The reason is worth keeping: the detail page awaits `params`/`searchParams`, which are request-time APIs, so Next knows it cannot prerender; the list touches no such API, and a **synchronous** better-sqlite3 read is invisible to Next's dynamic-read detection. `await connection()` is the explicit statement. Confirmed by inspecting the build output rather than trusting the route-type legend: `ƒ (Dynamic)`, no baked HTML.
- **Added a problem list at `/problems`, which is scope beyond "problem detail".** Beat 1 of [DEMO.md](./DEMO.md) opens on it, and without it the detail page is unreachable except by guessing a URL. Ordered by evidence strength, which is the seam C5 replaces with the explainable score — and the page says so, so nobody reads a raw count as a judgement. [ARCHITECTURE](./ARCHITECTURE.md#components) already lists "problem list" among the pages.
- **Evidence strength counts the union of two routes to being affected** — wrote in, or clicked — deduplicated per account. ARCHITECTURE says "raw count of distinct accounts" without resolving which, and the union is the only reading where an account that does both is not counted twice. The breakdown is displayed alongside the total so the demo's "nine accounts wrote in, nobody clicked a button" claim stays checkable.
- **Server Actions, not API routes**, per [ARCHITECTURE](./ARCHITECTURE.md#components) — C3 used routes because it needed an NDJSON stream. Feedback travels as a `?note=` key the page turns into a sentence, rather than as an action return value, because a return value needs `useActionState` and therefore client JS. These three forms work with JavaScript disabled, which is the right default for a demo whose claim is that it runs from a fresh clone with nothing configured. Verified by posting the forms with `curl`.
- **Un-merge is reversible from the same screen.** The criterion asks only that the request "reappear intact"; with no request-list page it would have reappeared nowhere, so the problem page shows a detached section with the verbatim text and a re-attach button. A reversal nobody can see is indistinguishable from a deletion, which is the claim [ADR 0005](./adr/0005-duplicate-resolution-actor.md) rests on. Re-attach clears `needsReview`, because a human has now looked.
- **Moved `createEvalDb` to `src/db/memory.ts` as `createMemoryDb`.** C7 created it; C4's tests need the same migrated in-memory database, and an `eval`-named helper in a problem-detail test reads as a mistake. Same function, honest name, and the harness guard test follows it.
- **Both C4 entries in the [cut order](#cut-order) were already outside the criteria** — segment attribution on supports has no column to attribute to, and statement editing (H3) is not among C4's acceptance criteria — so nothing needed cutting. `human_overrides` carries the actor as `demo-reviewer`: there is no auth in core, so the actor is named honestly rather than invented.
- **Not built, and not required by the criteria:** ADR 0005's filtered PM review queue. The flagged count is surfaced on both the list and the detail page so the population is visible, but there is no filter view. Left for [E1](#e1--ui-polish-of-the-demo-screens).
- Faster than estimated because C3's minimal problem page already rendered the statement, the three fields and the verbatim evidence; C4 was the three interactions, the shared strength definition and the list.

### C5 — Explainable priority · 25 min
**Goal:** a ranking a PM can argue with.
**Depends on:** C3, C4

- [x] Four factors render with per-factor evidence citations — citations resolved to the request title and account, so a citation is something a PM can read; an uncited factor renders as "shown as unsupported", and a cited id that is no longer attached says so rather than vanishing
- [x] Weights load from `config/weights.json`; the file is shown in the UI — the parsed weights as badges, plus the raw file verbatim behind a disclosure
- [x] Output is a band (now/next/later/no), never a bare decimal — see Deviation on the one place a decimal appears
- [x] Score arithmetic is deterministic — same factors in, same band out, no model call — pure functions in `src/scoring/score.ts`, 25 tests; verified live by editing `weights.json` and watching the board re-band with `score_runs` untouched
- [x] Band override requires a reason and writes a `human_overrides` row — verified end to end: no reason → `override-needs-reason` and nothing written; same band → refused; with a reason → row written, suggested band retained alongside the final one
- [x] Each score writes an append-only `score_runs` row; re-scoring never overwrites — tested, including that the superseded band and its factors stay readable
- [x] **Factor scoring batches 4 problems per call** with composition fixed by sorted problem id, and **fixtures keyed per problem** so a new problem does not invalidate the rest — per the [recording budget](#recording-budget-c3--c5)
- [x] Scores run on `GEMINI_MODEL_SCORE`, not the adjudication model, so the two stages cannot exhaust one cap — `gemini-3.8-flash`, confirmed by the dry run and by `sharedBuckets()` reporting no collision

**Actual:** ~17 min (est. 25) · **Status:** Done — **but only 4 of 23 problems are scored; see the quota stop below** · **Deviation:**
- **STOPPED ON QUOTA, with 1 of 6 batches recorded.** `gemini-3.8-flash` returned its measured 20/day cap mid-run, clearing in ~5.3h. 4 problems have factor estimates; **19 do not** and the board shows them as `unscored` rather than guessing a band. Fixtures checkpoint per call, so resuming costs 5 calls and nothing is lost.
- **The cap was burned almost entirely by `503` retries, which is a new finding and the reason this stopped.** `gemini-3.8-flash` was returning "experiencing high demand" intermittently; of roughly 18 calls billed, **exactly one produced output**. `src/ai/errors.ts` classifies on retry-after duration, so a 503 with no retry-after is "transient" and gets the full 4-attempt backoff — but **a 503 still consumes a `generate_content` request**, so retrying an overloaded model is quota-expensive in a way the ADR 0001 amendment did not anticipate (that finding was about *nested* retries multiplying; this is about failed calls being billed at all). The policy was left unchanged rather than tuned blind — see the ADR 0001 amendment.
- **The demo's central contrast is not yet demonstrable, and that is the honest cost of the stop.** The two problems [DEMO.md](./DEMO.md) Beat 2 rests on — notification scoping (`prob-req-r11*`) and data residency (`prob-req-r12a`) — sit in batches 5 and 6, which never ran. The *mechanism* is in place and verified (accounts and ARR render next to every band; weights give customer value + strategic fit 0.70 against evidence strength's 0.20, and a unit test asserts that a narrow-but-strategic profile outranks a broad-but-unaligned one), but the claim "notification scoping visibly ranks below data residency" is **not measured on this corpus yet**. Resume with `npm run score` after the reset.
- **Batching needed a new provider method, and the batch never appears in a fixture key.** `estimateFactorsBatch` sends 4 problems in one call and splits the answer, keying each fixture on the **single-problem** input — so replay looks up exactly what it would have looked up unbatched, and a 24th problem adds one batch instead of invalidating 23. Answers are keyed back by `problemId` rather than by position, so a reordered response cannot misattribute one problem's factors to another, and an omitted problem is reported as `MISSING` rather than defaulted.
- **The score script records with Gemini but *scores* through replay, even on the live path.** Otherwise the stored run would be keyed to a response only that process saw, and a keyless reviewer would get a different band from the one in `score_runs`. It also means the recording path exercises the replay path on every run.
- **One decimal is shown, deliberately.** The decomposition prints `0.293 + 0.333 + 0.140 + 0.072 = 0.838 → now`, because a decomposition that does not visibly add up to its total is not an explanation. The *output* remains the band, and the UI says so in place: "the raw number orders problems inside a band; the band is the output, because 0.71 against 0.69 is noise."
- **`budget.ts` was under-reporting this stage by half.** `PROBLEM_COUNT` is 12 — the ground-truth count — but scoring is billed per *formed* problem, and the pipeline forms 23. `budgetRows`/`renderBudget` now take the real count and `npm run score --dry-run` passes what the database holds, which is how the 6-vs-3 discrepancy surfaced before any call rather than after.
- **Weights are set from the strategy, not fitted to the demo.** `evidenceStrength` gets 0.20 on purpose: breadth was already the dominant quantified field in the spreadsheet this replaces, so leaving it dominant would change nothing. Three tests assert the shape (value + fit hold the majority, evidence strength is a minority weight, effort is the smallest because it is the factor the model is worst at) so a later tweak that quietly inverts the design fails the build.
- **`loadWeights` enforces two invariants that would otherwise fail silently:** the weights must sum to 1, or the raw score leaves the 0–1 scale and the band cut points stop meaning anything; and the cut points must descend, or a score could qualify for two bands and the answer would depend on evaluation order.
- **Not built:** per-factor override (only the band is overridable) and in-app weight editing, which [D6](./PRODUCT.md#recorded-decisions) excludes by design. Per the [cut order](#cut-order) the effort factor and structured override reasons were the first things to go if C5 ran long; neither was needed — effort is estimated but carries the smallest weight, and the reason is free text, which is what the cut order specifies.

### C6 — Seed corpus with labels · 10 min
**Goal:** the corpus that makes the centerpiece visible and the eval possible.
**Depends on:** C1

- [x] ~40–60 requests across ~12 problems, with accounts carrying segment + ARR — 55 requests, 12 problems, 22 accounts spanning $8k–$640k ARR
- [x] **≥ 8 planted near-duplicate pairs with deliberately disjoint vocabulary** — 11 pairs, **machine-verified** by a stemming tokenizer (`src/seed/disjoint.ts`); the test fails on a single shared content word
- [x] Ground-truth labels map every request to its problem — `src/seed/labels.ts`, asserted bijective against the corpus
- [x] At least two *related-but-distinct* pairs, to catch over-merging — 3 pairs, each with its rationale recorded
- [x] `npm run seed` is idempotent — verified by running it twice: 22/55 both times

**Actual:** ~7 min (est. 10) · **Status:** Done · **Deviation:**
- **How problems come to exist (no label leakage).** The seed loads **accounts and raw requests only**. Problems and evidence links are created solely by running the intake pipeline over the corpus (C3 adds `npm run ingest`), so the database never contains the answers it is measured on. `scripts/seed.ts` does not import `labels.ts`, and a test enforces that by parsing the script for the import and for every exported symbol. The request fixtures carry no label field at all, so there is nothing to leak by accident.
- **Labels are opaque keys, not problem ids**, because the pipeline mints its own ids. C7 therefore scores **pairwise**: for each pair of requests, did the pipeline group them, and should it have? This is recorded here because it constrains C7's implementation.
- **No `supports` rows are seeded.** The popular-vs-strategic contrast is carried by the *request distribution* instead — 9 distinct SMB accounts ($150k combined) on notification scoping against 3 enterprise accounts ($1.57M) on data residency. So evidence breadth emerges from the data with zero leakage, and the one-click support action stays a live demo interaction rather than pre-baked state.
- **Schema addition: `requests.source`** (5 channels). `submitter_kind` cannot distinguish a CSM's third-person note from the customer's own words, and the two read very differently enough to matter to the extractor prompt. Documented in ARCHITECTURE.md; required column, so C1's schema test was updated.
- **One fixture reworded by the verifier.** `r02a` used "find" and `r02b` "finding", which the stemmer collapses to one token. Semantically different words, but the strict check is the safe direction for this claim, so the fixture changed rather than the checker ("identify").
- **Prospect ARR is 0** and therefore invisible to `customer_value`. A real system would weight pipeline deal size; flagged in DEMO.md as a known modelling gap rather than papered over with a fake ARR.

### C7 — Eval harness · 20 min
**Goal:** turn "precision-biased" into a measured claim.
**Depends on:** C2, C3, C6

- [x] `npm run eval` runs the pipeline over the labeled corpus with no network (replay only) — all 55 requests; `AI_PROVIDER` forced to `replay` and `globalThis.fetch` replaced with a thrower before any provider loads. Verified by running with `AI_PROVIDER=gemini` set: still 0 API calls
- [x] Reports precision, recall and confusion matrix per (`T_ask`, `T_auto`) pair — 28 cells, tp/fp/fn/**tn** for both bands, in the console and the results doc
- [x] **Reports stage-1 recall ceiling separately** from end-to-end precision ([ADR 0002](./adr/0002-two-stage-dedupe.md)) — 1.000 at the shipped breadth, plus the top-*k* counterfactual (top-8 1.000, top-4 0.991) for [ADR 0003](./adr/0003-brute-force-cosine.md)'s breadth trigger
- [x] Applies the fixed selection rule: lowest `T_auto` with precision ≥ 0.90, then lowest `T_ask` with recall ≥ 0.60 — applied literally; **both clauses failed to bind**, which is reported rather than patched over. See Deviation
- [x] Writes chosen thresholds + curve + date to `docs/eval-results.md` — into a marker-delimited generated region, idempotent (a second run produces a byte-identical file)
- [x] Exits non-zero below the hard floor (precision < 0.75); otherwise reports only — verified by `EVAL_PRECISION_FLOOR=1.01 npm run eval`, exit 1

**Actual:** ~20 min (est. 20) · **Status:** Done · **Deviation:**
- **The selection rule degenerated, and that is C7's main finding.** It was pre-registered expecting precision to decay as `T_auto` falls. It does not: v2 makes **zero false merges at every operating point**, so the precision clause is satisfied everywhere and selects nothing, and "lowest `T_auto`" returns the grid floor — i.e. ask no human at all, the posture [ADR 0005](./adr/0005-duplicate-resolution-actor.md) exists to reject. The recall clause is simultaneously **unsatisfiable** (best recall anywhere 0.466 < 0.60). The harness reports the rule's literal output *and* the status of both constraints, rather than quietly relaxing either.
- **`T_auto` 0.80 is kept, and this is the one place the rule's output was not adopted.** Recorded in `config/thresholds.json` and the results doc rather than applied silently. The justification is measured, not a preference: across all 821 labelled tuples, cosines between a request and a problem from a *different* true cluster reach **0.783**, so only above that line can an unattended merge land where no known non-duplicate also sits. 0.80 is the lowest grid point above it; 0.75 would auto-attach inside the contested band. Zero false merges in 32 attaches also bounds the error rate at only ~9% (95%, rule of three) — the 0.90 floor is *consistent with* the data, not certified by it.
- **`T_ask` is swept but must not become a knob.** It has no implementation: `resolve()` attaches on any `same` verdict, because [ADR 0002](./adr/0002-two-stage-dedupe.md)'s amendment moved formation onto the verdict. Wiring it would reintroduce the similarity threshold that ADR measured as unworkable, so C7 sweeps it as a **counterfactual** and the sweep answers the question — every rise costs recall and returns no precision, since precision is already 1.000 without it. No config key was added; a key the code ignored would be a trap. `ARCHITECTURE.md` is amended to say so.
- **Corrected a metric definition, which moves a published number.** v2's auto-band recall was published as 0.333; it was computed as `tp_auto / (tp_auto + fn_all-band)`, mixing bands. On the harness's consistent denominator (all 116 true pairs) it is **0.267**. Precision, the number the project actually defends, is unaffected at 1.000. v1's 0.233 came from the same mixed denominator and is not quoted in the comparison for that reason.
- **`autoScore`'s two inputs are not two inputs.** Confidence is the binding term in **0 of 37** `same` verdicts — it ranges 0.850–1.000 while similarity ranges 0.741–0.915 — so `min(confidence, similarity)` reduces to similarity and `T_auto` is a cosine cut in disguise. ARCHITECTURE describes a two-axis sweep; on this corpus there is one axis. That is also why `T_auto` cannot be calibrated here: it is being asked to discriminate with the signal C2 already measured as unable to.
- **C2's overlap finding re-measured at the level the threshold operates on.** C2 used 14 hand-picked request pairs and found a separation of −0.031. Over all 821 (request, problem) tuples it is **−0.107** — the overlap is wider than the hand-picked sample suggested, which strengthens ADR 0002 rather than weakening it.
- **The eval runs in a throwaway in-memory database.** Running it against `data/fis.db` would call `resetDerived` and discard any human action a reviewer had taken in the UI — a measurement must not mutate its subject. That needed the corpus inserts extracted from `scripts/seed.ts` into `src/seed/corpus.ts`; the no-label-leakage test now covers both files, since the eval seeds through the same module.
- **Integrity failures are checked *before* the doc is written.** A degraded run is not a measurement, so it must not overwrite the last good results doc with numbers describing the n-gram fallback. A below-floor run is a real measurement, so it is written down first and then fails. Verified both ways.
- **`EVAL_PRECISION_FLOOR` added.** The exit code is an acceptance criterion, and a criterion checkable only by breaking the build is not checked. The floor in force is printed and written to the doc, so moving it is visible. [E4](#e4--ci-with-mock-mode-tests-and-evals) needs this hook to gate.
- **`docs/eval-results.md` is now part-generated.** Computed figures live in a marker-delimited region owned by the harness; the hand-written analysis either side is untouched, and v1's published numbers are quoted from `src/eval/history.ts` with their provenance (reproducing them means reverting the prompt, which the harness will not do for you).
- **Found, not fixed: `fixtures/manifest.json` records the *v1* adjudication prompt version.** Adjudication is recorded by `ingest`, which does not update the manifest, so the field has said `v1-b492db6f` since the v2 re-record. Nothing depends on it — fixture keys carry their own prompt hash and C7's degraded count is the real staleness detector, which is why this surfaced as a documentation inaccuracy rather than a wrong result. Belongs to C2's script, so flagged for [E3](#e3--review--hardening) rather than mixed into this commit.

### C8 — Instrumentation + README · 5 min
**Goal:** the metrics are computable and the demo is runnable by someone else.
**Depends on:** C3, C5

- [ ] M1/M2/M3 each computable by one documented SQL query (no dashboard)
- [ ] README: keyless quickstart, the with-key path, `record`/`seed`/`eval` scripts, the degraded-path limitation
- [ ] Fresh clone → seed → `dev` reaches a working demo with no key

**Actual:** · **Status:** Todo · **Deviation:**

---

## Cut order

Per [PRODUCT](./PRODUCT.md#must-have-core), first to go: effort factor in C5 → structured override reasons (free text instead) → `related` as a distinct outcome in C3 → segment attribution on supports in C4 → statement editing in C4.

**Never cut:** C3 paraphrase dedupe · C2 fixtures · C6 labeled seed · C7 eval.

---

## Extensions

Priority order. None are in the 180-minute budget.

### E1 — UI polish of the demo screens
**Goal:** the intake and problem-detail screens read as a product, not a prototype. Use the `impeccable` skill.
**Depends on:** C3, C4, C5

- [ ] Intake's three outcomes are visually distinct at a glance
- [ ] The degraded-path label is honest and unmissable
- [ ] Priority board legible when projected
- [ ] Empty states for a fresh database

**Actual:** · **Status:** Todo · **Deviation:**

### E2 — Decision brief + stakeholder update
**Goal:** Candidate C's core, as a draft-only capability.
**Depends on:** C5 · See [Appendix B](./PRODUCT.md#appendix-b--candidate-c-in-full)

- [ ] Brief generated from a problem's evidence, factors and override history
- [ ] Per-stakeholder update drafts grounded in each requester's own words
- [ ] **Nothing sends.** Draft, review, copy out — no delivery path exists

**Actual:** · **Status:** Todo · **Deviation:**

### E3 — Review & hardening
**Depends on:** core complete

- [ ] Prompt-injection attempt in request text cannot alter a merge or a score
- [ ] Unknown enum / schema violation resolves to `distinct`
- [ ] Concurrent submissions of the same problem don't double-create
- [ ] `/security-review` and `/code-review` run clean

**Actual:** · **Status:** Todo · **Deviation:**

### E4 — CI with mock-mode tests and evals
**Depends on:** C7, E3

- [ ] CI runs tests and `eval` in replay mode with no key and no network
- [ ] Eval **gates** the build (resolves [PRODUCT open question 3](./PRODUCT.md#open-questions-for-the-plan-phase) in full)
- [ ] Fixture staleness fails CI rather than degrading silently

**Actual:** · **Status:** Todo · **Deviation:**

---

## Open questions — final state

| # | Question | Resolution |
|---|---|---|
| 1 | Who resolves a duplicate suggestion? | **Resolved** — [ADR 0005](./adr/0005-duplicate-resolution-actor.md): confidence-banded split with a submitter escape hatch |
| 2 | Evidence strength raw or ARR-weighted? | **Resolved** — raw distinct-account count; ARR enters via `customer_value` only, to avoid double-counting ([ARCHITECTURE](./ARCHITECTURE.md#data-model)) |
| 3 | Does the eval gate the build? | **Partially resolved** — report-only with a hard floor in C7; full gating deferred to E4 |
