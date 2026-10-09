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
- [x] **Factor scoring batches 4 problems per call** with composition fixed by a deterministic recording order, and **fixtures keyed per problem** so a new problem does not invalidate the rest — per the [recording budget](#recording-budget-c3--c5). All 23 problems scored in 6 calls
- [x] Scores run on `GEMINI_MODEL_SCORE`, not the adjudication model, so the two stages cannot exhaust one cap — see the bucket move below; `sharedBuckets()` reports no collision among the stages that still need quota

**Actual:** ~17 min + ~14 min for the bucket move and recording (est. 25) · **Status:** Done — **all 23 problems scored, Beat 2 verified** · **Deviation:**
- **Beat 2 is measured, and the margin is large.** Data residency bands **`now` at 0.890 and sits #1 of 23** on the board; notification scoping's largest fragment bands **`no` at 0.305 and sits #19** — on *four* distinct accounts against data residency's *three*. Fewer accounts, higher band. The decomposition says exactly why: `strategic_fit` 1.00 against 0.10, and `customer_value` 1.00 against 0.20. The model also volunteered the tension on the losing side unprompted — *"a widely-felt usability problem that does not contribute to the company's core strategic goals"* — which is the sentence a PM should have to argue with. Full table in [DEMO.md](./DEMO.md).
- **Scoring moved to the fast tier's model, for quota reasons, with a stated quality cost.** The strong tier's measured 20/day cap had been burned by 503 retries (below). Extraction and adjudication are both fully recorded, so sharing their bucket risks nothing — a stage with complete fixtures makes no calls. Probed with **one call, no retry**, which succeeded; the remaining 5 batches then recorded cleanly. **6 calls, zero failures.** The tradeoff is real and unmeasured: factor estimation is the most judgement-heavy call in the system and nothing in this build scores the scores, so there is no before/after. Fully argued in the [third ADR 0001 amendment](./adr/0001-llm-provider.md).
- **The budget check had to change to allow the move, and the new rule is the more honest one.** `sharedBuckets()` warned whenever two `generate_content` stages shared a model — which would have flagged this move as a danger and blocked the only option available. But a collision only matters if **both** stages still need quota: a finished stage cannot be stalled and cannot stall anything. It now takes the set of active stages, and sharing with a completed stage is reported as a note explaining why it is safe. If extraction's prompt were ever edited its fixtures would invalidate, it would need quota again, and the collision would become real — at which point the check reports it, which is the behaviour that matters.
- **The factors row's cap is now derived from the model it points at, not written down.** It claimed "20/day measured" after the stage had moved to a model with a ≥57/day lower bound — reporting a fact about a model no longer in use. Compared by *tier* rather than by model id, because no model id may appear in `src/`.
- **`503` retries are what burned the strong tier's cap, and it is a new finding.** Of roughly 18 calls billed that day, **exactly one produced output**. `src/ai/errors.ts` classifies on retry-after duration, which is right for telling a quota 429 from a transient one, but a 503 carries no retry-after, so it gets the full 4-attempt backoff — and **a 503 still consumes a `generate_content` request**. The first ADR 0001 amendment was about *nested* retries multiplying one logical call; this is about failed calls being billed at all. Policy left unchanged rather than tuned blind (it cannot be tested without a live overloaded model); recorded as the [second ADR 0001 amendment](./adr/0001-llm-provider.md) and flagged for [E3](#e3--review--hardening). The practical answer shipped instead: `npm run score -- --probe` spends **one** call with no retry to answer "is this bucket usable right now?".
- **Recording order is now an argument, not a constant.** `--first=<ids>` records named problems ahead of the default sorted order, which is how both Beat 2 problems landed in the *probe* call — so even a single successful call would have made the demo's claim verifiable. Kept as a CLI flag rather than hardcoded demo ids so the default stays deterministic and the reordering is auditable in shell history; the dry run prints the resulting composition.
- **DEFECT FOUND AND NOT FIXED: the model's `evidence_strength` contradicts its own definition.** [ARCHITECTURE](./ARCHITECTURE.md#data-model) resolves PRODUCT open question 2 by making evidence strength a **raw distinct-account count**, with ARR and segment reaching the score through `customer_value` alone — precisely so the same signal is not counted twice. The estimates import segment anyway: **0.90 for three enterprise accounts against 0.60 for four SMB accounts.** `prompts/factors.md` describes the factor as "independent corroboration" but never forbids weighting by who the accounts are, so the gap is in the prompt. **Not fixed, deliberately:** editing that prompt changes its content hash and invalidates all 23 fresh score fixtures, which would show every problem as `unscored` and break the demo until 6 more calls were spent. It changes no band on this corpus — recomputing with a count-faithful evidence strength leaves both Beat 2 bands where they are, because value and fit carry 0.70 of the weight — and the board prints the real account count beside the estimate, which is how it was spotted. Flagged in DEMO.md's limits and for a pass with quota to spare.
- **Fixed a bug the probe exposed: the replay provider loaded fixtures at construction.** On the live path it was built before the recording loop, so it was blind to everything that run had just written and reported all 23 problems as degraded — the probe recorded 4 estimates and then wrote 0 `score_runs`. It is now constructed after recording. The symptom only appears when recording and scoring happen in one process, which is exactly what the probe does.
- **The 4 estimates recorded on the strong tier are now stale and inert.** A fixture key includes the model id, so moving bucket invalidated them; they stay on disk and are never looked up, like the v1 adjudication fixtures. Reverting the model would cost zero quota for those four.
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

- [x] M1/M2/M3 each computable by one documented SQL query (no dashboard) — all three in the [README](../README.md#success-metrics), each **run against `data/fis.db` and its real output pasted beside it**; M1's labelled precision/recall is explicitly *not* a SQL query, because the labels are deliberately absent from the database
- [x] README: keyless quickstart, the with-key path, `record`/`seed`/`eval` scripts, the degraded-path limitation — plus the free-key URL, all 15 npm scripts marked for whether they spend quota, and the expected output of each setup step so a silent degradation is visible
- [x] Fresh clone → seed → `dev` reaches a working demo with no key — **verified by actually doing it**, which is how the defect below was found; see Verification

**Actual:** ~40 min (est. 5) · **Status:** Done · **Deviation:**
- **DEFECT FOUND AND FIXED — the fresh-clone keyless path was completely broken, and it is the one claim the whole demo rests on.** Cloning the repo and following the setup with no `.env` gave `real extractions: 0/56, real embeddings: 0/56`. A fixture key includes the model id (`src/ai/hash.ts`), model ids came from the environment only, and with nothing configured they resolve to `''` — so **every** lookup missed and the entire pipeline fell back to n-grams. That is not a degraded demo, it is the *opposite* of the central claim: [ADR 0004](./adr/0004-record-replay-provider.md) exists because n-grams cannot match "add CSV export" to "finance can't get the numbers into Excel", which is precisely what a reviewer would have been shown.
- **Fix: model ids fall back to the committed `.env.example` template when env is silent.** Not a convenience — on the replay path the *correct* model id is the one the fixtures were recorded with, and [ARCHITECTURE](./ARCHITECTURE.md#components) already names `.env.example` as the one place model ids live. Env still wins when set, which is what recording needs. No literal enters `src/`, so C2's grep criterion still returns nothing.
- **The fallback reads a file that sits one line from an API-key placeholder, so it is a whitelist, not a filter.** `TEMPLATE_KEYS` permits five model ids and `EMBED_DIM` and nothing else; two tests pin the list, assert the loaded values can never match a Google key shape, and assert env beats template. `requireGeminiConfig()` deliberately still checks `process.env` directly rather than the effective config: the template's defaults are right for *replaying*, but a run about to spend real quota should have been told in so many words which models it will bill.
- **`verify:replay` was printing the models it was *not* using**, which is why this survived C2. It read `manifest.models` for the display line while looking fixtures up with the (empty) env values — so it reported the correct model names and then failed all 56 inputs. It now prints both the **effective** models and their source (`env` / `.env.example` / `NOTHING`) above the recorded ones. Two lines that must agree, side by side, is the check that would have caught this in ten seconds.
- **`DEMO.md`'s setup block was missing `ingest` and `score`.** Following it exactly produced an empty problem list and an unscored board, because the seed loads accounts and raw requests only — problems exist because the pipeline formed them, which is C6's no-label-leakage guarantee. The block now has both commands and says why they are not optional, and points at the README as the authoritative copy so the two cannot drift.
- **M1 cannot be a SQL query, and saying so is the honest version.** Ground truth lives in `src/seed/labels.ts` and never reaches the database — a test parses `scripts/seed.ts` to enforce it. So the acceptance criterion is met by documenting the metric's **production counterpart** in SQL (per-band attaches and the rate at which a human later undid one) and pointing the labelled precision/recall at `npm run eval`. Checked that the query actually measures something rather than printing constants: un-merging one flagged attach moves the flagged band to 0.909 and leaves the auto band at 1.000.
- **M3's query returns no rows on a freshly ingested database, which is the correct answer.** Nothing is pre-baked — 0 overrides, 0 supports. Verified it populates by driving the real no-JS override form with `curl` in the clone: no reason → refused, nothing written; with a reason → one row, suggested and final both retained. The README shows the empty case *and* the populated one rather than only the flattering one.
- **Costed ~40 min against a 5-min estimate, ~8× over, and the estimate was wrong in kind rather than in degree.** C8 was budgeted as "write the README", which is what it would have been had the third criterion not been checked. Verifying a fresh clone is what turned it into a bug hunt — and the bug was total, in the project's load-bearing claim. The estimate assumed the demo path worked because it had always worked *here*, on a machine with a `.env`.
- **Two notes left for [E3](#e3--review--hardening) rather than mixed in:** `npm run record -- --dry-run` warns that extract and factors share a bucket even though extraction is fully recorded (C5 taught `sharedBuckets()` about active stages, but `record.ts` still calls `renderBudget()` with no argument, so it uses the strict rule) — conservative and harmless, but inaccurate. And the manifest's stale v1 adjudication prompt version, already logged by C7.
- **Scope held.** No metrics dashboard ([PRODUCT non-goal](./PRODUCT.md#non-goals)), no new npm script for the queries — the README is the documented place, and the queries are pasted with the output they actually produced. The one UI change is flipping C8's own badge on `/`; the default `Create Next App` page title is left for [E1](#e1--ui-polish-of-the-demo-screens).

**Verification** — every step re-run in a throwaway clone at `git clone` + `npm install`, with **no `.env` present**:

| step | result |
|---|---|
| `npm run db:migrate` · `seed` | 10 tables · 22 accounts, 55 requests, 0 problems |
| `npm run verify:replay` | **56/56** real extractions and embeddings, 0 degraded, deterministic |
| `npm run ingest` | **23 problems**, 32 attached (11 flagged), **0 degraded**, 0 API calls |
| `npm run score` | **23** `score_runs`, bands now 4 · next 8 · later 4 · no 7 under `w2`, 0 degraded |
| `npm run eval` | precision **1.000** / recall **0.466**, floor PASS, and `docs/eval-results.md` regenerated **byte-identical** |
| `npm run record -- --dry-run` | runs keyless and now prints real model names in the budget table |
| `npm run build` | clean; route types unchanged |
| `npm run dev` + all four pages | 200, problem list shows 23 problems / 11 flagged |
| Beat 3, typed live through `/api/intake` | auto-attach to `prob-req-r01b`, cosine **0.822**, verdict `same`, **0 degraded** |
| the three human-in-the-loop forms | override refused without a reason, recorded with one; un-merge flips `active` and leaves `body_raw` intact |

The main repo's `data/fis.db` was left at its canonical demo state (23 problems, 23 score runs, 0 overrides, 0 supports) — every interaction test ran in the clone, so DEMO.md's account counts still match what a reviewer sees.

---

## Cut order

Per [PRODUCT](./PRODUCT.md#must-have-core), first to go: effort factor in C5 → structured override reasons (free text instead) → `related` as a distinct outcome in C3 → segment attribution on supports in C4 → statement editing in C4.

**Never cut:** C3 paraphrase dedupe · C2 fixtures · C6 labeled seed · C7 eval.

---

## Extensions

Priority order. None are in the 180-minute budget.

### E1 — UI polish of the demo screens
**Goal:** the intake and problem-detail screens read as a product, not a prototype. Use the `impeccable` skill.
**Depends on:** C3, C4, C5 · **Outside the appetite** ([PRODUCT](./PRODUCT.md#optional-extensions-out-of-appetite)) — time-boxed to ~30 min, one review round, no new capability beyond the review queue. Direction recorded in [DESIGN.md](./DESIGN.md).

- [x] ADR 0005's filtered PM review queue (the flagged population is countable today, but there is no view) — deferred out of C4 → `/review`: 11 flagged attaches, verbatim request + verdict + target problem, confirm or reject. Reject *is* `detachEvidence` — one code path with the detail page, so the two screens cannot disagree about what rejection means. `confirmEvidence` is the one new mutation: clears the flag, marks the suggestion `accepted`, appends to `human_overrides` (agreement is recorded, or M3's override rate reads as if nobody agreed). 10 tests in `src/problems/review.test.ts`
- [x] AI provenance made legible — verdict, confidence and cosine next to the verbatim request on `/review` and on problem detail; `human_overrides` rendered as "human changed `field` from → to, reason, actor"; the board names the model, provider and prompt version behind each factor estimate. All of it was already stored since C3/C8 and visible nowhere
- [x] Priority board legible when projected — band-grouped rows, the band chip and the distinct-account count at display size with ARR beside them, decomposition behind a disclosure. Verified: data residency reads `now · 3 accounts · $1.57M` at the top and notification scoping `no · 4 accounts · $79k` below it, which is Beat 2's whole claim in two seconds
- [x] Intake's three outcomes are visually distinct at a glance — auto-attach, attached-pending-confirmation (reserved amber) and new-problem are three different frames, not three copies of one card
- [x] The degraded-path label is honest and unmissable — a bordered notice in the reserved hue naming the capability it loses, on intake and on any evidence row whose request came through the fallback. Amber is reserved for `needs review` and `degraded` only; decorative use would make the label stop meaning anything
- [x] Empty, loading and error states on the demo screens — empty states name the command that fills them, `loading.tsx` skeletons match the row geometry they replace (and become the prerendered PPR shell), one root `error.tsx` that names the migrate/seed/ingest/score recovery, `not-found.tsx` explaining that re-ingest retires problem ids
- [x] Page metadata still says `Create Next App` — one line, found during C8's fresh-clone pass and left here rather than widening that task

**Verified:** all seven routes 200 against the production build; Beat 3 typed through the intake API auto-attaches at score 0.822 / confidence 0.99 / 0 degraded; confirm and reject driven over HTTP with **no client JavaScript** (multipart POST → 303) writing the right flag, suggestion action and history row; 212 tests, typecheck and lint clean; demo database rebuilt to its canonical state (55 requests, 23 problems, 11 flagged, 23 score runs, 0 overrides, 0 supports, 0 degraded) and `npm run eval` reproducing precision 1.000 / recall 0.466.

**Second pass — browser review (fix E1):**

- [x] **Font bug.** `--font-sans: var(--font-sans)` in the theme block was self-referential, so the declaration was invalid and **every screen rendered in the browser's default serif**. Pointed at `--font-geist-sans` with a real fallback stack; confirmed in the built CSS (`html{font-family:var(--font-geist-sans),…}`), on the rendered `<html>` class that defines it, and by both woff2 files serving 200
- [x] **Band inflation.** `w1` put 10 of 23 problems in `now`, which is a list rather than a prioritisation. `w2-2026-10-08` cuts `now` at 0.80 and `next` at 0.65 — the two widest gaps in the measured distribution (0.815/0.780 among the leaders, 0.665/0.520 between the real candidates and the tail), so no boundary splits a cluster of near-identical scores and `later` stays at 0.35. Result **now 4 · next 8 · later 4 · no 7**, with data residency #1 in `now` and notification scoping in `no`. Config-only, no model calls. `npm run eval` re-run per the project rule: identical to the previous run (precision 1.000 / recall 0.466), which it must be — the harness scores dedupe, and **nothing in this build measures band cut points at all**, now said plainly in `weights.json` and DESIGN.md
- [x] **Copy written for a PM.** No task IDs, demo beat numbers, ADR paths, `T_auto`, `npm run …` or "the extractor" anywhere in the product UI; the depth stays in the README, `docs/` and code comments. Stored enums became sentences (`same` → "the same problem", `needs_review: false` → "confirmed as the same problem"), and the honest-numbers note survived in plain language — "the right answer here is 12 problems, not 23 … of the matches it made on its own, none were wrong". **One judgement call, flagged rather than hidden:** `app/error.tsx` keeps its `npm run` recovery, because a crash screen is read by whoever is running the project locally and the exact command is the kindest thing on it
- [x] **Intake no longer says it twice.** The page header and the form card carried the same explanation; the card's copy is gone and the header rewritten for a CSM filing minutes after a call
- [x] **README "60-second version"** at the very top: thesis, centerpiece, why AI is load-bearing, the measured numbers including the v1 → v2 prompt rewrite, the one-command quickstart, and the ~286-vs-180-minute overrun
- [x] **`docs/LOOM_SCRIPT.md`** — a 5-minute script with exact click paths and every number checked against the committed demo state
- [x] **`npm run demo:reset`** — one command back to canonical, tested three times in a row after confirming, rejecting and submitting the demo request

**Third pass — the Loom script was unreadable in five minutes (docs E1):**

- [x] `docs/LOOM_SCRIPT.md` was **1,889 spoken words — 12:36 at 150 wpm**, for a five-minute Loom. Now **686 words, 4:34**, measured by counting the `>` lines with a script rather than by eye. Time budgets rebalanced to the sections that earn them: problem and thesis 0:38 combined, live demo 2:01, architecture 0:40, eval and gaps 0:38, how AI was used 0:38
- [x] The **live demo was cut least** (386 → 303 words) because it is the only part a reviewer cannot get from the README. Every click path and every on-screen number survives intact: 23 problems against a truth of 12, the demo request at 0.822 / 0.99 with the zero-shared-words point, "actually, mine is different", one confirm and one reject in `/review`, data residency (3 accounts, $1.57M, `now`) against notification scoping (4 accounts, $79k, `no`), and the factors opened under "Why this band"
- [x] Everywhere else, one or two sentences per idea, written to be **spoken**: short sentences, no parentheticals, nothing that only works on the page
- [x] **No number changed.** Every figure re-checked against the state `npm run demo:reset` produces — counts and bands queried from the database, 0.822 / 0.99 re-run through the live intake endpoint, and 0.741 / 0.772, 0.974 → 1.000, 0.319 → 0.466, the 0.60 pre-registered target and 286-vs-180 traced back to the ADRs, eval results, PRODUCT and the README

**Actual:** ~110 min total (~55 + ~40 + ~15) · **Status:** Done · **Deviation:** the first pass ran ~25 min over its 30-minute box. The Loom script shipped at 12:36 of speech for a five-minute video — written to be complete rather than to be said out loud, and nothing in the first two passes measured it. Counting with a script instead of reading it back is the cheap check that would have caught it immediately. Three things were not polish and took the time: provenance needed a new read module (`src/problems/provenance.ts`) because nothing had ever read `dedupe_suggestions` back out; the review queue needed `confirmEvidence` plus tests, since no existing mutation cleared the flag on an *attached* link; and verifying the queue end to end meant driving Server Actions over curl. Two defects found and logged to E3 rather than fixed here (`resetDerived` cannot re-run after `score`, and it is not transactional). The home page was re-cut as a demo-path index — it is the first screen of the demo path, and its build-progress checklist served the author, not the reviewer.

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
- [ ] The 503 retry policy ADR 0001's second amendment declined to tune blind — a failed call is still a billed call
- [ ] `fixtures/manifest.json` records the **v1** adjudication prompt version; `ingest` writes those fixtures and never updates the manifest *(found by C7)*
- [ ] `npm run record -- --dry-run` warns that extract and factors share a bucket even though extraction is fully recorded: `record.ts` calls `renderBudget()` with no argument, so it uses the pre-C5 strict rule instead of the active-stage one *(found by C8)*
- [ ] `generateObject` is deprecated in AI SDK 7; prompt versions render `v1-<hash>` where `v1` is the *scheme* version, which reads misleadingly *(both found by C2/C3)*
- [ ] 9 npm audit findings, all dev-tooling-only, with no non-breaking fix available *(found by C1)*
- [ ] **`npm run ingest` cannot be re-run after `npm run score`**: `resetDerived` deletes `problems` but not `ai_decisions`, whose `problem_id` references them, so the delete fails on the foreign key. The documented recovery is to delete `data/fis.db` and redo migrate → seed → ingest → score *(found by E1 while restoring the demo database)*
- [ ] **`resetDerived` is not transactional**, so the failure above leaves a half-reset database — 23 problems with zero evidence links, which `score` then reports as 23 degraded rather than as a broken state. Wrap it in one transaction and fail cleanly *(found by E1)*. `npm run demo:reset` works around both by clearing every table itself, in one transaction, in child-first order — the workaround lives in the demo script precisely so the defect stays visible here
- [ ] **A long-lived SQLite connection outlives a deleted database file.** `src/db/index.ts` opens one connection at import, so deleting `data/fis.db` under a running `npm run dev` leaves the server reading and writing an unlinked inode: a reset looks like it worked and the pages keep serving the old data. `demo:reset` avoids it by clearing rows in place, but any other tooling that replaces the file has the same trap *(found by E1 while testing `demo:reset`)*

**Actual:** · **Status:** Todo · **Deviation:**

### E4 — CI with mock-mode tests and evals
**Depends on:** C7, E3

- [ ] CI runs tests and `eval` in replay mode with no key and no network
- [ ] Eval **gates** the build (resolves [PRODUCT open question 3](./PRODUCT.md#open-questions-for-the-plan-phase) in full)
- [ ] Fixture staleness fails CI rather than degrading silently

**Actual:** · **Status:** Todo · **Deviation:**

### E5 — Interactive architecture diagrams
**Goal:** a reviewer can see the shape of the system and the path one submission takes, without reading the code first. **Reference material, not a product feature** — nothing ships into the app.
**Depends on:** core complete · **Outside the appetite** ([PRODUCT](./PRODUCT.md#optional-extensions-out-of-appetite)) · Built with the `archify` skill, installed globally and deliberately **not** committed into this repo.

- [x] Two diagrams only: one architecture, one sequence. Both authored as Archify JSON and delivered through `finalize` at `--quality showcase`; all four gates pass on each (schema validation, delivery, strict provenance check, real-browser check). JSON source committed beside the HTML in `docs/diagrams/`
- [x] **Architecture** drawn from `src/`: 12 components, the intake path as the emphasised route, Gemini as the one external dependency, and two boundaries — the Next.js process, and the security group where untrusted request text is handled. 29 file-and-line references, verified by the tool against committed bytes at the pinned revision
- [x] **Sequence** is one intake submission with both degraded branches and all three outcomes, each stated with its condition. Formation follows the `same` verdict; the note on the auto-attach message says in so many words that 0.80 only decides whether a human confirms. 9 references
- [x] **No invented infrastructure.** A card names what is absent — no queue, no cache, no vector index, no separate backend — because a reader who has seen other diagrams will assume otherwise
- [x] Linked from `ARCHITECTURE.md` (one paragraph) and the README (one table row). Neither restates the architecture
- [x] Both opened as real 1440×900 captures and inspected. One defect found and fixed that no gate caught: the sequence's first segment label rendered behind the leftmost participant box

**Found while drawing, and worth more than the diagrams:** `docs/ARCHITECTURE.md`'s stage table says retrieval takes the top *k* (k=8), but `config/thresholds.json` ships `candidateLimit: "all"` and the pipeline compares every live problem — 23 per request on this corpus. The diagram follows the code and the discrepancy is now named in `ARCHITECTURE.md` rather than left for a reader to trip over. Also corrected against the code: scoring reads its estimates back through the **replay** provider (`scripts/score.ts:206`), recording through Gemini only when a key is set, so the arrow goes to replay rather than to the abstract interface.

**Actual:** ~70 min · **Status:** Done · **Deviation:** the skill's own `npx skills add tt-a1i/archify` timed out cloning at 300s; cloning manually (~50s) and installing from the local path worked. Most of the remaining time went to one measured constraint at a time — the Reader caps viewBox width by projected font size, caps height for the legend, and requires a ratio ≥ 1.55 before it will narrow a canvas, so the sequence had to satisfy three at once and lost a participant (`resolve`, a pure function the pipeline calls) to fit.


### E6 — Redesign: "claro y vivo"
**Goal:** the six demo screens match the approved Design System. **Skin and motion only** — no feature, route, data field or API change, per [PRODUCT Non-Goals](./PRODUCT.md#non-goals).
**Depends on:** core complete, E1 · **Outside the appetite** · Branch `redesign`; `main` stays recordable until the merge is approved
**Reference:** Design System artifact, version `1791429185-4f66`, exported to [`docs/design/reference/`](./design/reference) · Direction recorded in [DESIGN.md](./DESIGN.md)
**Budget: ~340 min**, which is more than the entire 180-minute core build. Stated up front rather than discovered at the end.

| # | Step | Budget | Commit |
|---|---|---|---|
| 0 | Reference into the repo + rewrite `DESIGN.md` | 25 min | `feat(E6): design reference and direction` |
| 1 | Tokens and fonts | 35 min | `feat(E6): tokens and fonts` |
| 2 | Shell — sidebar, icon rail, mobile tab bar, page header | 45 min | `feat(E6): app shell` |
| 3 | Shared pieces — band, flag, measure, meter, provenance, buttons, inputs, segmented control, skeletons, toasts | 50 min | `feat(E6): shared pieces` |
| 4 | Base motion — stagger, bars, lift, expand, reduced-motion | 25 min | `feat(E6): base motion` |
| 5 | **The three Loom screens** — Review, New request, Priority | 90 min | `feat(E6): loom screens` |
| 6 | Problems, Problem detail, Overview | 50 min | `feat(E6): remaining views` |
| 7 | Mobile pass at 390px + empty/loading/not-found/error | 45 min | `feat(E6): mobile and states` |

**Every step is pushed as soon as it is committed.** Sessions here have hit usage limits mid-task twice; progress that only exists locally does not survive that.

- [x] **0 ·** 31 reference files under `docs/design/reference/`. `DESIGN.md` rewritten: records which E1 decisions are **superseded** and why, and keeps the three that still hold
- [x] **1 ·** `tokens.json` mapped into `globals.css` per `Implementacion.md`'s equivalence table, Day + Night through `prefers-color-scheme` with no toggle. Tailwind v4's `dark` custom variant redefined to the media query so every existing `dark:` utility keeps working — **and checked that none silently stops applying**. Plus Jakarta Sans / DM Sans / JetBrains Mono through `next/font` after reading `node_modules/next/dist/docs`. **Fonts verified in the built CSS and on the rendered `<html>`**, never by eye: E1 shipped the whole app in Times behind a self-referential `--font-sans`
**Fixed in review, same step:** between 700 and 1100px the page header collapsed. `.pghead` stayed a row, the metrics were `shrink-0` at ~520px, and the title column was `min-w-0`, so once the row was narrower than the metrics the title squeezed to a **12px ribbon 180px tall** and the lede to **12 × 1638**. Fixed twice over: the row may now wrap, the title column carries a real `flex: 1 1 24rem` basis so it can never be squeezed to nothing at any width, and the rail breakpoint stacks the header outright. Remeasured in headless Chrome over the DevTools protocol — no new dependency — at 390/700/760/900/1099/1100/1280/1440 on all five routes: the title is **564 × 36** at 700px where it was 12 × 180.

- [x] **2 ·** 264px sidebar ≥1100px, 88px icon rail 700–1100px, 60px header + floating tab bar <700px. "New request" the only filled button in the sidebar. Review's pending count in amber, an amber dot in the rail. Every page: eyebrow, title, one-line lede
**Measured at step 3, in headless Chrome:** buttons **56 / 48 / 40** (lg / default / sm) with 17–15px labels and nothing below 40; the amber flag 28px and the count badge 26px; the "Why" disclosure collapsed to height **0** and expanding without JavaScript measuring anything. Cards, fields and the segmented control exist but are not yet reachable from a view — the pages still carry E1's markup, which steps 5 and 6 replace.

- [x] **3 ·** Shared pieces at the reference's sizes — buttons 48/56/40px with 16px text, inputs 54px, cards radius 20 (28 hero), pill chips, meter with a threshold tick. Re-scales `src/components/ui/{button,badge,card}.tsx`
- [ ] **4 ·** `rise`/`growx`/`pop` keyframes, `[data-stagger]` at 45ms capped at 12 rows, `grid-template-rows: 0fr→1fr` expands, durations 140/240/560/900ms, `ease-out` and `ease-spring`. One small client component for count-up. **Everything stops under `prefers-reduced-motion`, final state shown immediately**
- [ ] **5 ·** Review: queue plus one decision at a time, gauge with threshold tick, animated confirm and reject. New request: wide form, sliding channel selector, animated five-step pipeline, three result variants. Priority: weights bar, expandable rows with factors — **band, account count and ARR render final on load, no count-up, because this board gets projected**
- [ ] **6 ·** Problems (sliding filter, staggered rows), Problem detail (hero card, evidence cards, sticky aside), Overview (bento grid, count-up on the three figures)
- [ ] **7 ·** All six at 390px, 44px minimum touch target, decision actions fixed above the tab bar
- [ ] Loom labels preserved verbatim: "New request", "Use the demo request", "Submit", "Actually, mine is different", "Review", "Confirm — same problem", "Reject — not the same problem", "Priority", "Why this band"
- [ ] `LOOM_SCRIPT.md` click paths updated for Review's one-at-a-time queue, still under 700 spoken words, every number still matching what `npm run demo:reset` produces
**Measured at step 1 — `npm run check:contrast`:** all **62** pairs clear their threshold in both themes, so `tokens.json` needed no adjustment. `line-strong`, the one token that has to work against three different surfaces, is the tightest: **3.48 / 3.76 / 3.19** on surface / raised / sunken in Day and **4.98 / 4.56 / 5.08** in Night, against a 3:1 requirement. The next tightest is `flag-line` on `surface` at 3.20. The check reads the committed reference rather than the CSS, so a drift between the two fails the script instead of becoming a slightly-too-pale border nobody measures.

- [ ] AA contrast **measured** in both themes; amber only for needs-review and degraded; all routes 200; tests, typecheck, lint, build and the Impeccable detector pass; no new dependency; no eval run and no model calls

**Deliberate departure from the reference, agreed before starting:** `Vistas.md` makes Priority four band *tab cards* that swap the panel, showing one band at a time. **Priority stays stacked.** The Loom's key beat is data residency in `now` at the top against notification scoping in `no` below it, in one view, often projected — tabs destroy exactly that contrast. The four band cards are built as a summary header (band name and count) whose cards are **anchor links that scroll to their band**, which keeps the design's shape without costing the comparison.

**Actual:** · **Status:** In progress · **Deviation:**
---

## Open questions — final state

| # | Question | Resolution |
|---|---|---|
| 1 | Who resolves a duplicate suggestion? | **Resolved** — [ADR 0005](./adr/0005-duplicate-resolution-actor.md): confidence-banded split with a submitter escape hatch |
| 2 | Evidence strength raw or ARR-weighted? | **Resolved** — raw distinct-account count; ARR enters via `customer_value` only, to avoid double-counting ([ARCHITECTURE](./ARCHITECTURE.md#data-model)) |
| 3 | Does the eval gate the build? | **Partially resolved** — report-only with a hard floor in C7; full gating deferred to E4 |
