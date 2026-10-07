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

- [ ] `next dev` serves a page with no console errors
- [ ] Drizzle schema covers all 10 tables from [ARCHITECTURE](./ARCHITECTURE.md#data-model); `migrate` runs clean on an empty file
- [ ] Tailwind + shadcn/ui render one styled component
- [ ] `.env.example` lists all four model/dim vars with no real key committed
- [ ] `tsc --noEmit` passes

**Actual:** · **Status:** Todo · **Deviation:**

### C2 — Provider abstraction + record/replay · 35 min
**Goal:** all four model capabilities behind one interface, usable with or without a key.
**Depends on:** C1, C6 · **ADR:** [0001](./adr/0001-llm-provider.md), [0004](./adr/0004-record-replay-provider.md)

- [ ] `AiProvider` interface: `extractProblem`, `embed`, `adjudicate`, `estimateFactors`
- [ ] Gemini implementation uses `generateObject` with Zod schemas for every non-embedding call
- [ ] `npm run record` populates `fixtures/` for the whole seed corpus + scripted demo request
- [ ] Replay provider resolves a recorded input by hash and returns the identical object twice in a row
- [ ] Unrecorded input falls back to n-grams and sets `degraded: true`
- [ ] Every call writes one `ai_decisions` row with stage, model ID, latency and token usage
- [ ] Model IDs are read from env; `grep -r "gemini-" src/ lib/` returns nothing

**Actual:** · **Status:** Todo · **Deviation:**

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

**Actual:** · **Status:** Todo · **Deviation:**

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

**Actual:** · **Status:** Todo · **Deviation:**

### C6 — Seed corpus with labels · 10 min
**Goal:** the corpus that makes the centerpiece visible and the eval possible.
**Depends on:** C1

- [ ] ~40–60 requests across ~12 problems, with accounts carrying segment + ARR
- [ ] **≥ 8 planted near-duplicate pairs with deliberately disjoint vocabulary**
- [ ] Ground-truth labels map every request to its problem
- [ ] At least two *related-but-distinct* pairs, to catch over-merging
- [ ] `npm run seed` is idempotent

**Actual:** · **Status:** Todo · **Deviation:**

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
