# Feature Intelligence System — Product Spec

**Status:** spec (phase 1 of spec → plan → tasks → implementation)
**Downstream:** `docs/ARCHITECTURE.md`, `docs/adr/*`, `docs/TASKS.md`
**Source brief:** `Technical AI Assessment.pdf` (MetaCTO) — 2–3 hour build, AI must be core to how the system solves the business problem.

---

## Executive Summary

- **Problem.** Teams can see how many people asked for something, never what problem those people share. The same need enters as *N* unrelated records in *N* vocabularies, and vote count — the only quantified field — measures the popularity of a *wording*, not the severity of a problem.
- **Thesis.** A feature request is not a unit of demand; it's a piece of evidence about demand. Votes on solutions aggregate the wrong object, and every downstream step inherits that error.
- **Centerpiece.** Duplicate resolution at intake, running on the AI-**extracted underlying problem** rather than raw wording. Before a record exists, a submission resolves into *attach as evidence* / *link as related* / *create new*.
- **Why AI.** The same problem arrives in lexically **disjoint** vocabularies — "add CSV export" vs. "finance can't get the numbers into Excel" share no content words. Keyword, trigram and tag-taxonomy methods fail on exactly the half that matters. Deterministic code still does all arithmetic.
- **Supporting.** Explainable prioritization: AI estimates factors from evidence with citations, deterministic code computes the score, output is bands (now/next/later/no) rather than false-precision ranks.
- **Measurement.** Dedupe precision/recall against a **labeled** seed set, via an eval harness inside the core build. Each metric is graded by how credibly this build can measure it.
- **Appetite.** ~3h implementation, ~4h total elapsed, scope flexes. One thing must be excellent: catching a duplicate problem stated in completely different words.
- **Keyless demo.** Real Gemini outputs are recorded into committed fixtures and replayed, so a reviewer with no API key sees true semantic matching rather than a degraded string matcher ([D5](#d5-revised--recordreplay-not-synthetic-embeddings)).

---

## Problem Statement

Product teams can see **how many people asked for something**. They cannot see **what problem those people share**.

Requests arrive solution-shaped ("add a CSV export button"), in each requester's vocabulary, through channels that don't talk to each other — tickets, sales calls, CSM notes, Slack, in-app forms. The same need therefore enters as *N* unrelated records whose only quantified signal is a vote count.

The damage compounds *backwards*: ungrouped requests make triage irreducibly manual → manual triage is the first thing dropped in a busy week, so the queue ages → an aged, ungrouped queue leaves vote count as the only comparable number, so prioritization defaults to popularity → popularity-driven decisions are hard to justify, so rationale goes unrecorded → unrecorded rationale can't be communicated back → requesters who never hear anything stop submitting, and those who do stop explaining themselves.

That last link is the one teams miss: **poor communication degrades the quality of future intake.** The loop isn't just unfair to customers, it starves the dataset.

---

## Target Users & Usage Scene

**Primary — Product Manager (decides).** B2B SaaS, 50–500 employees, 2–3 product areas, an assumed 30–150 requests/week. A 30–45 min triage block at the start of the week plus 5-minute checks between meetings; laptop browser, frequently projected in prioritization meetings, so the ranked view must stay legible at distance. Pressure is bursty — triage is unblocked work with no deadline, so it loses to everything else. **Consequence:** the core loop must be completable in minutes and resumable mid-way. A tool you visit, not one you live in.

**Secondary — CSM / AE / Support agent (submits).** Files for a customer minutes after a call, between meetings, on laptop or phone, with roughly **60 seconds of attention** — after which they type it into Slack instead and the signal dies. **Consequence:** intake must return value *inside the same interaction* ("this matches a problem 23 other customers have raised"), or there's no incentive to use the front door. Also a hard latency budget on the intake pipeline.

**Tertiary — Product leader (reads).** Monthly, before a roadmap review, usually projected. Needs to see *why* the ranking is what it is in one screen, without a walkthrough.

**Out of scope — the end customer**, whose problem it actually is. Internal submitters stand in.

---

## Platform

**web**

Every user above is already in a browser when the need arises (CRM, helpdesk, Slack), the artifact is frequently projected, and web is the only target a reviewer can run locally with zero install friction.

---

## Lifecycle Map — Where Time and Decision Quality Are Lost

| Stage | Time lost | Decision quality lost |
|---|---|---|
| **1. Intake** | Near zero — this stage *feels* cheap. | **The most expensive loss, and it's invisible.** Vocabulary is fixed at entry, the underlying problem is never recorded, and no duplicate check happens at the one moment deduplication is free: *before the record exists.* |
| **2. Triage** | Linear in volume, done by the most expensive person in the loop. | Tagging is inconsistent between reviewers and across weeks; fatigue drives shallow reads; "is this new?" is answered from memory. |
| **3. Grouping** | Re-reading what triage already read; manual re-clustering that goes stale immediately. | **Signal fragmentation:** one problem raised 40 times in 40 wordings presents as 40 small asks and loses to one raised 12 times consistently. The team systematically underweights its most widely-felt problems. |
| **4. Prioritization** | Rebuilt from scratch each cycle in spreadsheets nobody updates. | Vote count is the only quantified field, so it dominates by default. Customer value and strategic fit live in people's heads; weights are implicit, so identical inputs yield different rankings across quarters and PMs. |
| **5. Decision** | Re-litigating settled questions every cycle. | **"Why not" is never written down** — no institutional memory, no trigger to revisit when inputs change, no way to audit consistency. |
| **6. Communication** | Bespoke writing exactly when the PM has least time, so it's skipped. | Requesters learn filing is pointless. Sales and CS can't answer "what happened to my ask?", so they escalate — and escalation volume becomes a competing, worse prioritization signal. |

**The load-bearing conclusion:** losses propagate *downstream* from intake, so leverage is highest *upstream*. Fixing prioritization without fixing grouping applies better math to fragmented inputs.

---

## AI Intervention Candidates

### Candidate A — Problem extraction + duplicate resolution at intake

The semantic front door. On submit, before a record exists: extract the underlying problem into a fixed schema (job to be done, current workaround, blocked outcome), embed it, retrieve nearest existing problems, adjudicate each as *same* / *related* / *distinct*, resolve in the same interaction.

- **Benefits:** the submitter gets instant acknowledgment and sees their input land somewhere real; the PM's queue shrinks at the source; CS and sales can check whether a problem is already tracked before filing.
- **Why AI, not rules:** disjoint vocabulary defeats every lexical method, and the solution→problem abstraction is a generative judgment, not a lookup. Rules are better downstream for arithmetic; they cannot produce this input.
- **Risks:** over-abstraction and false merges (both in [Challenge](#challenge-to-the-thesis) #2–3); "duplicate" reading as rejection; untrusted request text flowing into a prompt that drives a merge decision.
- **Human judgment stays:** confirming merges in the uncertain band; authoring and renaming canonical statements; splitting a drifted problem. Every merge reversible with evidence-level provenance.

### Candidate B — Explainable prioritization from accumulated evidence

Score each problem as a visible decomposition — customer value, strategic fit, evidence strength, effort — each factor citing its evidence, ranked into bands. AI estimates factors from unstructured text because the inputs are prose; deterministic code does the arithmetic. → [full analysis](#appendix-a--candidate-b-in-full)

### Candidate C — Decision memory + stakeholder communication loop

Decision briefs, a durable "why not" ledger, and per-stakeholder update drafts grounded in each requester's original words. Highest blast radius of the three, so nothing customer-facing ever auto-sends. → [full analysis](#appendix-b--candidate-c-in-full)

### Recommendation

**Primary: A. Supporting: B. Extension: C.** Confirms [D1](#recorded-decisions); reasoning recorded so the plan phase inherits it.

1. **Leverage.** A removes the upstream cause of the triage, grouping and prioritization losses. B and C treat downstream symptoms of A's failure.
2. **Falsifiability.** Deduplication is the one AI output a reviewer can check in seconds — either two requests describe the same problem or they don't. Scores and generated briefs are plausible-looking by construction and much harder to catch being wrong. In a 3-hour build, a capability whose quality is *visible* beats one whose quality is unverifiable.
3. **Appetite fit.** A + B are demonstrable end-to-end in budget. C's value is only legible over time and across real stakeholders; in a short demo it degrades into "look, the LLM wrote an email."

---

## Challenge to the Thesis

The reframing — **a request is evidence about demand, not a unit of demand** — is the strongest idea here. Build on it. Four things do not follow from it.

**1. Don't remove the vote — re-point it.** The vote isn't only a popularity signal; it's the cheap mechanism that *generates* signal at all. Nobody writes a paragraph about their underlying need, and if authoring evidence is the only way to participate, the corpus starves. Keep the one-click action, attach it to the **problem**. The live risk is recognition: someone who asked for dark mode won't see themselves in "reduce visual fatigue during extended sessions." **Mitigation:** always render a problem alongside its verbatim evidence. The abstraction must never replace the original text — only index it.

**2. Over-abstraction is the main technical threat, and it attacks the centerpiece directly.** The characteristic failure of LLM "underlying need" extraction is laddering too far up: *CSV export → get data out → interoperability → trust the platform.* At the top, everything is one theme and dedupe merges genuinely distinct problems. **Mitigation:** pin the level with a rigid output schema. "Current workaround" is the load-bearing field — concrete by nature, and it resists laddering. Abstraction level is an explicit, testable property of the extractor, not an emergent one.

**3. Dedupe errors are asymmetric, so don't tune for balanced F1.** A **false merge** hides demand, is nearly undetectable afterwards, and silently corrupts every downstream score. A **false split** is visible as two suspiciously similar problems and is cheap to fix later. So: bias auto-merge for **precision**, route the uncertain band to human confirmation, accept a higher miss rate, keep every merge reversible at evidence granularity. This asymmetry drives the thresholds, the eval targets and the UX. Also: *duplicate* and *related* are different outcomes — same problem, different segment or scope, is information a binary merge/don't-merge destroys.

**4. "Weighted by customer value and strategic fit" can launder judgment into false objectivity.** Replacing votes with a weighted sum whose weights were invented in a meeting swaps one bad heuristic for a better-dressed one — and PM approval doesn't fix it, because a reviewer shown a confident 7.4 rubber-stamps it. Approval is only real when disagreement is cheap. **Mitigations:** bands over precise ranks; per-factor decomposition with citations; displayed confidence; weights as a visible PM-owned artifact; and override capture as a first-class concern ([M3](#success-metrics)) — a near-zero override rate means the humans stopped thinking, which is a product failure reported as a success.

**Design consequence carried into the plan:** single-shot embedding similarity is a weak discriminator exactly where it matters — "same problem" vs. "adjacent problem" is semantic, not geometric. The pipeline is therefore **two-stage**: embedding retrieval for cheap recall over top-*k* candidates, then one LLM adjudication pass for precision. Two model calls at intake against the 60-second submitter budget; the latency trade is accepted and noted for `ARCHITECTURE.md`.

---

## Primary Capability

**Problem-level duplicate resolution at intake.** Before a record exists, extract the underlying problem from solution-shaped text, search existing problems semantically, and resolve into **attach as evidence** / **link as related** / **create new** — explained, reversible, human-confirmed below high confidence.

Acceptance properties, in priority order: (1) **works across disjoint vocabulary** — otherwise it's a string matcher with extra steps, and this is the property the eval measures; (2) **explains itself** — every suggestion shows the matched statement, its existing evidence and the basis for the match, because a merge the PM can't audit is one they shouldn't accept; (3) **reversible at evidence granularity**, restoring verbatim text; (4) **precision-biased and measured**, not asserted; (5) **degrades honestly** — unavailable or unsure means a new problem with a flag, never dropped, never silently merged.

**Supporting:** explainable prioritization — AI estimates factors from evidence, deterministic code computes the score.

---

## Success Metrics

A 3-hour build on a seeded corpus cannot credibly measure most of what this system would be judged on in production. Each metric therefore states what **this build** measures and what **production** would measure, rather than borrowing the latter's authority for the former.

**M1 — Dedupe precision / recall against a labeled set. *Hard evidence.***
The eval harness ([C7](#must-have-core)) runs the full pipeline over the seed corpus, whose ground truth is authored as labels — which requests belong to the same problem — and reports precision, recall and the confusion matrix at each candidate threshold, **justifying the chosen auto-merge threshold from that curve.** This is what converts "precision-biased" from a claim into a measurement. *Pre-registered targets,* stated before the run so they can't be fitted after it: precision ≥ 0.90 in the auto-merge band, recall ≥ 0.60 overall; precision is the one that matters, per challenge #3. *Credibility limit:* I author both corpus and labels, so this scores the pipeline against *my* notion of a duplicate on ~60 items, with the threshold fitted on the same data it's evaluated against. Not external validation. Its value is that the threshold is chosen by evidence rather than vibe, and that regressions become visible. *Production counterpart:* containment rate × accept rate on suggestions — deliberately not a headline here, because on a corpus I built, containment measures my seed, not the model.

**M2 — Human adjudication load. *Measurable now.***
The share of submissions the pipeline resolves confidently vs. routes to a human, and how many candidates a human must read to decide — both computable from one run over the seed corpus, with no time dimension required. This **replaces wall-clock "time to triage"**, which on synthetic timestamps is a fabricated number that hedging doesn't rescue. Adjudication load is the actual *mechanism* by which triage time falls, and it's real today. *Production counterpart:* `created_at` → `triaged_at` median and queue aging; the timestamps are instrumented so the metric is computable from day one, but no number is claimed from demo data.

**M3 — PM override capture. *Instrumentation only at this scale.***
What ships is that every override is captured with suggested value, final value and reason in append-only records, so suggested and final are both retained permanently. *Honest limit:* with one PM clicking through a demo, *n* ≈ 5 — any override *rate* from that is noise, and reporting it as a result would be padding. *Production counterpart:* override rate as the honest test of whether approval is real (challenge #4); ~15–40% is my prior for a healthy band, a hypothesis to calibrate rather than a benchmark. The recorded *reasons* are the highest-value artifact the system produces: the input to weight tuning and the seed of Candidate C's decision memory.

---

## Appetite

**Implementation: ~3 hours, fixed. Overall cap: ~4 hours elapsed**, including spec, plan and ADRs. **Time is fixed; scope flexes** — overruns get cut, not extended.

The budget is tight enough to state exactly: this spec landed at ~40 minutes, leaving **~20 minutes for the plan and ADRs** before the 3-hour implementation starts. That is less than the hour the plan phase would comfortably take, so the tension is named rather than hidden — if planning runs long it is absorbed by the implementation budget through the cut order below, not by extending the cap. That is what "time is fixed, scope flexes" means in practice.

**`prompts.txt` timestamps are the source of truth** for elapsed time, and they will show the spec and planning phases, not just the build. No claim is made that the whole project fits in 3 hours; the claim is that the *implementation* does, and that front-loading the spec is what makes that possible. Read the log rather than taking this paragraph's word for it.

**The discipline:** exactly one thing must be excellent — catching a duplicate problem stated in completely different words. Everything else may be thin. A reviewer who sees that one moment work understands the thesis; six half-features communicate nothing.

### Must-have core

| # | Scope | Budget |
|---|---|---|
| C1 | Next.js App Router + TypeScript + Drizzle/SQLite skeleton, Tailwind + shadcn/ui | 25 min |
| C2 | Provider abstraction: Gemini via Vercel AI SDK, **record/replay fixture provider**, record script | 35 min |
| C3 | Intake: extract → embed → retrieve → adjudicate → three-way resolution inline | 40 min |
| C4 | Problem detail: canonical statement, verbatim evidence, strength, "this affects us too" | 20 min |
| C5 | Explainable priority: factor decomposition with citations, bands, override with reason (weights in config) | 25 min |
| C6 | Seed corpus **with ground-truth duplicate labels** | 10 min |
| C7 | **Eval harness:** pipeline vs. labels, precision/recall per threshold, threshold justification | 20 min |
| C8 | Instrumentation logging (no dashboard) + README + demo path | 5 min |
| | **Total** | **180 min** |

**C6 is not polish.** The centerpiece is invisible on an empty database. The corpus needs ~40–60 requests across ~12 problems with **planted near-duplicates in deliberately disjoint vocabulary** — those cases prove the thesis, and the labels on them are what make C7 possible. Corpus and eval are one unit of work.

**Cut order** (first to go, in order): effort factor in scoring → structured override reasons (fall back to free text) → *related* as a distinct outcome from *duplicate* → segment attribution on support actions → problem-statement editing in the UI.

**Never cut:** paraphrase dedupe (C3) · record/replay fixtures (C2) · labeled seed (C6) · eval harness (C7). The first three are the demo; the fourth is the evidence the demo isn't a fluke. Without C7 the central claim is an assertion.

### Optional extensions (out of appetite)

Decision briefs and the "why not" ledger · per-stakeholder update drafts (Candidate C) · emerging-need detection over a time window · customer-facing portal · Slack / Zendesk / HubSpot adapters · batch re-clustering · pgvector migration · metrics dashboard UI · held-out test set and threshold cross-validation.

---

## Recorded Decisions

| ID | Decision | Standing |
|---|---|---|
| **D1** | **Centerpiece:** duplicate detection at intake on the **extracted underlying problem**, not raw wording. | Confirmed, independently argued in [Recommendation](#recommendation). Pipeline is two-stage (embed → LLM adjudicate). → ADR |
| **D2** | **Supporting:** explainable prioritization weighted by customer value and strategic fit. | Confirmed, with the constraints from challenge #4. |
| **D3** | Decision briefs are an extension, not the core. | Confirmed. Correct for a 3-hour appetite — brief quality is unverifiable in a short demo. |
| **D4** | **Stack:** Next.js (App Router) + TypeScript, SQLite + Drizzle, Tailwind + shadcn/ui. | Confirmed. One constraint for the plan: SQLite has no vector index. At seeded scale (hundreds of rows) brute-force cosine over embeddings stored as BLOB in Node is correct and simpler than adding `sqlite-vec`; name the scaling path, don't pre-build it. → ADR |
| **D5** | **AI:** Gemini via Vercel AI SDK behind a provider abstraction, plus a no-key provider. Rationale: no paid API budget; reviewers must run it free. | Confirmed, **with the no-key provider redesigned to record/replay** — below. → ADR |
| **D6** | Prioritization weights live in a **config file**, not the UI, for this build. | New; resolves a previously open question. D2 says PM-owned, which argues for the UI; appetite says config. Either way the weights stay a visible, version-controlled artifact — the property that actually matters. |
| **D7** | Process: spec → plan + ADRs → tasks → implementation; prompt logging per `CLAUDE.md`. | Confirmed. |

### D5 revised — record/replay, not synthetic embeddings

The original plan was a deterministic mock using hashed character n-grams. **That design fails the product.** Determinism is not capability: n-gram similarity cannot match "add CSV export" to "finance can't get the numbers into Excel", because the two share nothing beyond noise. The reviewer-without-a-key path — the one most likely to be exercised — would fail on precisely the planted duplicates that exist to prove the thesis, and would demo the *opposite* of the central claim.

**Revised design:** a record script runs the real Gemini provider once over the seed corpus and the scripted demo request, capturing embeddings, extractions and adjudication verdicts into committed JSON fixtures keyed by a hash of the normalized input. The replay provider serves those fixtures, so with no API key the full pipeline runs on **real model outputs** — genuine semantic matching, deterministic, offline, no cost. Novel input falls back to hashed n-grams at a conservative threshold, **labeled in the UI as a degraded path**.

**Limitations, stated plainly:** fixtures cover recorded inputs only. Free-typed input outside the seed falls back to n-grams, which **will** miss paraphrases with disjoint vocabulary — the capability's own headline case. That path is labeled rather than hidden, so a reviewer is never shown a degraded result dressed as the real one. The full capability requires an API key (free tier suffices) and the README says so. Fixtures are a snapshot: if prompts change they must be re-recorded, so staleness is detected by input hash rather than tolerated.

**Secondary benefit:** fixtures make M1's eval reproducible. Without them, precision/recall drifts between runs on model nondeterminism and the number means nothing.

---

## Non-Goals

- No customer-facing portal; nothing is sent to any end customer. Not a replacement for talking to customers — the system organizes evidence, it doesn't generate insight that wasn't in the evidence.
- No auth, roles or multi-tenancy; no external integrations (Slack, Zendesk, HubSpot, Jira); no real-time collaboration.
- No fine-tuning or training; prompting and retrieval only.
- No roadmap or delivery tracking — the system ends at the decision and its rationale.
- **No metrics dashboard UI** — instrumentation is logged and queryable, the view is an extension. *(Cut to fund the eval harness.)*
- **No in-app weight editing** — config file only, per [D6](#recorded-decisions).
- **No held-out test set or cross-validation** — the eval runs against the labeled seed only, per M1's credibility limit.
- **No wall-clock triage-time claims** from demo data, per M2.
- **No guarantee of semantic matching for unscripted input without an API key**, per [D5](#d5-revised--recordreplay-not-synthetic-embeddings).

---

## Assumptions, Risks & Tradeoffs

**Assumptions**

- **A1** *(validate first)* — a meaningful share of real intake is semantic duplicates. If true duplication is under ~10%, the centerpiece solves a small problem and focus should shift to B. The seed assumes ~30%: an assumption, not a finding.
- **A2** — submitters accept "your request joined an existing problem" **if** they see their own words preserved alongside the problem's accumulated evidence. Untested, and the strongest counter-argument to the thesis if false.
- **A3** — a PM will engage with a factor decomposition rather than skipping to the number (mitigated by showing bands, not precise scores), and Gemini's free tier covers fixture recording and demo-scale use.

**Risks** — three are High: **over-abstraction** collapsing distinct problems into mega-themes (breaks the centerpiece), **false merges** hiding real demand undetectably, and the **appetite** versus the ambition of the thesis. Four more are Medium. Full table with severities and mitigations: → [Appendix C](#appendix-c--risk-table).

**Tradeoffs accepted**

- **Precision over recall on merges** — the demo will visibly miss some duplicates. Correct behavior given the asymmetry, stated out loud rather than hidden.
- **Brute-force vector search over a real index** — correct at this scale, with a named scaling path.
- **Depth over surface area** — the brief is "less interested in the specific feature and more interested in how thoughtfully AI is incorporated," which rewards one capability that provably works over six that demo.
- **AI estimates, deterministic code computes** — more plumbing, for scores that are reproducible and auditable.
- **Fixtures over a synthetic mock** — a recording step and a staleness risk, for a keyless path that demonstrates the real capability instead of contradicting it.

---

## Open Questions for the Plan Phase

1. **Who resolves a duplicate suggestion — the submitter or the PM?** Leaning: submitter for high-confidence attach, PM for the uncertain band. The product's most sensitive UX decision; deserves its own ADR.
2. **Is "evidence strength" a raw count or weighted by segment/ARR?** Weighting is more correct and more gameable.
3. **Does the eval harness gate the build** (fail below target precision) or only report? Gating is the stronger engineering statement but risks a red build inside a 3-hour window.

→ Next: `docs/ARCHITECTURE.md`, plus ADRs for D1, D4, D5 and open question 1.

---
---

# Appendix

Product reasoning moved out of the main body for skimmability. Nothing here is superseded — it is the full form of what the body summarizes in a line.

## Appendix A — Candidate B in full

**Explainable prioritization from accumulated evidence.** Score each problem as a visible decomposition — customer value, strategic fit, evidence strength, effort — each factor citing the evidence that produced it, ranked into bands.

- **Benefits:** the PM gets a defensible ranking; leadership sees reasoning instead of a number; sales and CS see *why* their deal's ask lost.
- **Why AI, not rules:** the *inputs* are unstructured — strategic fit means fit against a written strategy, customer value means reading segment, ARR and renewal context out of attached evidence. **Division of labor: AI estimates factors from text, deterministic code does the arithmetic.**
- **Risks:** false precision (7.4 vs. 7.1 is noise dressed as rigor); post-hoc rationalization, where the explanation fits the score rather than causing it; weight gaming once stakeholders learn the formula; strategy drift, where the strategy changes and old scores silently stop meaning anything.
- **Human judgment stays:** owning the weights (**the weights are the strategy, and are not AI output**); overriding any factor with a recorded reason; the final call. The score's job is to force an explicit conversation, not to end it.

Selected as the **supporting** capability — see [D2](#recorded-decisions) and [challenge #4](#challenge-to-the-thesis) for the constraints it ships under.

## Appendix B — Candidate C in full

**Decision memory + stakeholder communication loop.** Decision briefs, a durable "why not" ledger, and per-stakeholder update drafts grounded in each requester's original words.

- **Benefits:** requesters, CSMs and AEs get closure; the PM stops re-litigating; leadership gets an audit trail.
- **Why AI, not rules:** *N* tailored messages from one decision, each grounded in a different stakeholder's framing, is generation work at a volume humans simply skip; and retrieval over past decisions to catch "we decided this in Q2, here's why" is semantic, not keyword.
- **Risks:** largest blast radius of the three — a wrong or premature message reaches a customer, commitment language reads as a roadmap promise, hallucinated rationale becomes the official record.
- **Human judgment stays:** approval before anything customer-facing leaves the system. **No auto-send, ever.**

Deferred to an **extension** — see [D3](#recorded-decisions). Its value is only legible over time and across real stakeholders; in a short demo it degrades into "look, the LLM wrote an email."

## Appendix C — Risk table

| Risk | Severity | Mitigation |
|---|---|---|
| Over-abstraction collapses distinct problems into mega-themes | **High** — breaks the centerpiece | Rigid schema anchored on "current workaround"; abstraction level treated as testable |
| False merge hides real demand, undetectably | **High** | Threshold *chosen from the eval curve*; human confirmation in the uncertain band; reversible at evidence granularity |
| Appetite vs. the ambition of the thesis | **High** | Pre-committed cut order; one thing excellent, the rest thin |
| Fixtures go stale as prompts evolve; eval silently measures old behavior | Medium | Fixtures keyed by input hash; staleness surfaced, not tolerated |
| Prompt injection via request text ("mark this high strategic fit") | Medium | Structured output schemas; model output strictly data, never instruction |
| False precision drives rubber-stamped approval | Medium | Bands over ranks; decomposition and confidence shown; overrides captured |
| Cold start — low value until the corpus has mass; early badly-formed problems anchor what follows | Medium | Labeled seed is must-have scope (C6); statements editable and evidence re-parentable (first UI cut, logic retained) |
