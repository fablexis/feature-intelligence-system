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
2. **C7 (eval) immediately after C3 (pipeline), before any more UI.** Thresholds are chosen from the eval curve, and C5's priority demo is only meaningful once dedupe is calibrated. An early eval also catches a broken extractor before UI work is built on top of it. C3 ships reading thresholds from `config/thresholds.json`; C7 chooses the values; **C3 needs no code change** — which is why thresholds are config, not constants.
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

- [ ] Stages 1–5 run in order with per-stage timing recorded
- [ ] **A planted near-duplicate in disjoint vocabulary is matched to its problem** (the one case that must pass)
- [ ] Each of the three outcomes is reachable: auto-attach, ask-human, create-new
- [ ] `related` is stored in `problem_links`, distinct from an evidence attach
- [ ] "Actually, mine is different" creates a new problem and records the disagreement
- [ ] Every suggestion writes a `dedupe_suggestions` row **including rejected ones**
- [ ] Each stage's fallback is exercised by a forced-failure test; resolution never merges on failure
- [ ] UI shows stage-by-stage progress, not one spinner
- [ ] `body_raw` is stored verbatim and rendered escaped
- [ ] **Adjudication is skipped when no candidate clears the recall floor** — no model call when the answer is already known (first request of a problem); the skip is recorded as a `dedupe_suggestions` row with no verdict, so M1 still sees it
- [ ] Retrieval compares **only within one embedding space** ([C2](#c2--provider-abstraction--recordreplay--35-min)); a `gemini` query vector is never cosined against an `ngram` one
- [ ] `npm run record` gains `--stage=adjudicate` so one stage can be recorded without touching another's quota
- [ ] Adjudication fixtures recorded after ingest, within the budget below

**Actual:** · **Status:** Todo · **Deviation:**

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

- [ ] Canonical statement + the three schema fields render
- [ ] Every active evidence item shows its **verbatim original text** and account
- [ ] Evidence strength = distinct account count (per [ARCHITECTURE](./ARCHITECTURE.md#data-model))
- [ ] "This affects us too" is one click, idempotent per account
- [ ] Un-merge flips `evidence_links.active` and the request reappears intact

**Actual:** · **Status:** Todo · **Deviation:**

### C5 — Explainable priority · 25 min
**Goal:** a ranking a PM can argue with.
**Depends on:** C3, C4

- [ ] Four factors render with per-factor evidence citations
- [ ] Weights load from `config/weights.json`; the file is shown in the UI
- [ ] Output is a band (now/next/later/no), never a bare decimal
- [ ] Score arithmetic is deterministic — same factors in, same band out, no model call
- [ ] Band override requires a reason and writes a `human_overrides` row
- [ ] Each score writes an append-only `score_runs` row; re-scoring never overwrites
- [ ] **Factor scoring batches 4 problems per call** with composition fixed by sorted problem id, and **fixtures keyed per problem** so a new problem does not invalidate the rest — per the [recording budget](#recording-budget-c3--c5)
- [ ] Scores run on `GEMINI_MODEL_SCORE`, not the adjudication model, so the two stages cannot exhaust one cap

**Actual:** · **Status:** Todo · **Deviation:**

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

- [ ] `npm run eval` runs the pipeline over the labeled corpus with no network (replay only)
- [ ] Reports precision, recall and confusion matrix per (`T_ask`, `T_auto`) pair
- [ ] **Reports stage-1 recall ceiling separately** from end-to-end precision ([ADR 0002](./adr/0002-two-stage-dedupe.md))
- [ ] Applies the fixed selection rule: lowest `T_auto` with precision ≥ 0.90, then lowest `T_ask` with recall ≥ 0.60
- [ ] Writes chosen thresholds + curve + date to `docs/eval-results.md`
- [ ] Exits non-zero below the hard floor (precision < 0.75); otherwise reports only

**Actual:** · **Status:** Todo · **Deviation:**

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
