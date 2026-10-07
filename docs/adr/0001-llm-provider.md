# ADR 0001 — LLM provider: Gemini via the Vercel AI SDK

**Status:** accepted · **Date:** 2026-10-07 · **Relates to:** [D5](../PRODUCT.md#recorded-decisions), [ADR 0004](./0004-record-replay-provider.md)

## Context

The system needs four model capabilities: problem extraction, text embeddings, duplicate adjudication, and factor estimation. Two constraints dominate, and the first is not technical: **there is no API budget**, and a reviewer must be able to run the project for free. Everything else is secondary.

## Decision

Google Gemini via the Vercel AI SDK, behind a four-method `AiProvider` interface. Tiers are environment variables, never literals in code:

- `GEMINI_MODEL_FAST=gemini-3.1-flash-lite` — extraction *(see the amendment below; this was `gemini-3.8-flash` until the free-tier cap was measured)*
- `GEMINI_MODEL_STRONG=gemini-3.8-flash` — adjudication and scoring; `gemini-3.1-pro-preview` is the opt-in upgrade
- `GEMINI_MODEL_EMBED=gemini-embedding-001` — stable; `EMBED_DIM` confirmed at fixture-record time rather than assumed

The strong tier defaults to the stable Flash model because the current Pro is **preview-only**, and a preview model deprecating mid-assessment is a worse failure than slightly weaker adjudication.

## Alternatives

- **Claude** — likely the best adjudicator, but no free API tier and **no first-party embeddings endpoint** (Anthropic directs to third parties), so stage 2 would need a second provider and the whole thing would still cost money. Rejected on budget, not capability.
- **OpenAI** — paid only.
- **Ollama / local weights** — free, but hardware-dependent and requires the reviewer to install a runtime and pull gigabytes. Defeats the zero-friction goal.
- **Free aggregator pools** — volatile availability and rate limits; unacceptable for a reproducible demo.

## Consequences

Gemini's free-tier limits are **no longer published** on the rate-limits page — they are per-project in AI Studio — so quota is a genuine unknown. [ADR 0004](./0004-record-replay-provider.md) absorbs this: the demo path makes zero API calls. The AI SDK keeps provider swap cost at one file, so if the budget constraint lifts, the decision reverses cheaply. Choosing on budget means accepting we have not benchmarked adjudication quality across providers.

## Amendment, 2026-10-07 — the unknown quota turned out to be a *daily* cap

Recording C2's fixtures measured what the docs would not state: the free tier
allows **20 `generate_content` requests per day, per model**. Not per minute.
`gemini-3.8-flash` was exhausted after 7 extractions, with a stated retry-after
of **19h21m**.

Three consequences, all now in the code:

1. **Fast tier moved to `gemini-3.1-flash-lite`**, which has its own quota
   bucket with real capacity. Probed with a single call before committing to it.
2. **A per-minute throttle was the wrong instrument.** `RECORD_RPM` cannot
   protect against a daily cap; only reducing total calls or switching bucket
   can. The throttle stays as politeness, not as the guard.
3. **An exhausted daily quota must not be retried.** It arrives as a 429 that
   looks transient, so `src/ai/errors.ts` now classifies on the *retry-after
   duration* rather than the status code, and aborts immediately above 120s.

The expensive part was self-inflicted: the AI SDK retries internally (3
attempts) and the record script retried on top (4), so one logical call could
cost 12 real ones. SDK retries are now disabled at every call site and retrying
lives in exactly one place. **Lesson worth keeping: with an unmetered free
tier, nested retry layers are a quota amplifier, not resilience.**

Still open: adjudication (strong tier) has not been recorded yet and will face
the same cap. At ~12 problems it needs roughly one call per ingested request,
so the strong tier will likely need the same move to a lite model, or recording
across more than one day.

## Second amendment, 2026-10-07 — a failed call is still a billed call

Recording C5's factor estimates stopped on the same 20/day cap, but for a
reason the first amendment did not anticipate. `gemini-3.8-flash` was
intermittently returning **503 "experiencing high demand"**, and of roughly 18
requests billed that day, **exactly one produced output.** One batch of four
problems was recorded; the other five batches never ran.

The first amendment's lesson was that *nested* retry layers multiply one
logical call into many. This is a different and sharper one:

> **A 503 consumes a `generate_content` request.** Retrying an overloaded model
> does not cost nothing while waiting for capacity — it spends the same daily
> budget as a successful call, and spends it on no output at all.

`src/ai/errors.ts` classifies on retry-after duration, which is the right
instrument for telling a quota 429 from a transient one. But a 503 carries no
retry-after, so it is classified transient and gets the full four-attempt
backoff. On a metered free tier that is the worst case: four billed attempts,
no result, and the backoff makes the window in which the model recovers
*less* likely to fall inside the run.

**Not changed yet, deliberately.** The obvious fix — fewer retries on 503, or
treating "overloaded" as a stop rather than a backoff — is a policy change that
cannot be tested without a live overloaded model, and tuning it blind risks
replacing a known failure with an unknown one. What the data supports today is
the measurement above, not a specific new number. Recorded here so the next
person to hit it starts from the finding rather than rediscovering it; the
change itself belongs to [E3](../TASKS.md#e3--review--hardening).

**Operational consequence meanwhile:** when a stage stalls on an overloaded
model, the cheap move is to stop and resume after the daily reset rather than
to retry into the cap. Fixtures checkpoint per call, so a resumed run spends
quota only on what is still missing — `npm run score -- --dry-run` reports
exactly that number before anything is spent.

## Third amendment, 2026-10-07 — scoring moved to the fast tier

**Factor scoring now runs on `GEMINI_MODEL_FAST`'s model, not the strong
tier.** The reason is not quality, it is quota: the second amendment above
records that intermittent 503s burned the strong tier's measured 20/day cap
while producing one usable batch out of six. Waiting for the daily reset was
the alternative; moving bucket cost nothing and worked immediately.

### Why sharing a bucket is safe *now* and was not before

The original design gave each `generate_content` stage its own model so one
exhausted cap could stall at most one stage, and `renderBudget()` verified that
rather than asserting it. Scoring now shares the fast tier with extraction,
which looks like a violation of exactly that rule.

It isn't, because **extraction is finished.** All 56 extractions are recorded
and committed; a stage with complete fixtures makes no further calls, so it
cannot be stalled and cannot stall anything else. The check was therefore
changed to match the real invariant: `sharedBuckets()` now takes the set of
stages that *still need quota* and only warns when two of those collide.
Sharing with a completed stage is reported as a note, because it is the escape
hatch available when a model's cap is gone for the day — and a check that
flagged it as a danger would have blocked the only move left.

The same reasoning covers adjudication, which is also fully recorded. If
extraction's prompt were ever edited, its 56 fixtures would invalidate, it
would need quota again, and the collision would become real — at which point
the budget check reports it, which is the behaviour that matters.

### The quality tradeoff, stated plainly

The fast tier is a smaller model than the one the pipeline's judgement stages
were designed around, and factor estimation is the most judgement-heavy call in
the system: it reads prose and assigns four defensible numbers with citations.
So this is a real downgrade, not a free lunch:

- **It is not measured.** Nothing in this build scores the scores. The eval
  harness measures *dedupe* ([C7](../TASKS.md#c7--eval-harness--20-min)), which
  is why batching was judged safe here in the first place. There is no
  before/after comparison available, because the strong tier produced only one
  batch before its cap went — too few to compare against.
- **What the output looks like is reasonable but not above criticism.** The
  estimates are well-formed, cite real evidence ids, and the Beat 2 contrast
  comes out correctly and with a large margin. One defect is visible, recorded
  under [C5](../TASKS.md#c5--explainable-priority--25-min): the model's
  `evidenceStrength` imports segment and ARR, contradicting the raw-count
  definition that [ARCHITECTURE](../ARCHITECTURE.md#data-model) settled open
  question 2 on. That is a prompt gap, not obviously a model-size gap.
- **The mitigation is structural, and predates this choice.** Factors are
  estimates a PM overrides with a reason; the weights are PM-owned; the board
  shows the raw distinct-account count beside every band precisely so a reader
  can disagree with the estimate. A weaker estimator makes the override path
  more load-bearing, not less valid.

**If quota were not the binding constraint, the strong tier is the right place
for this stage.** Revisit when the cap resets and there is budget to record
both and compare — which would also be the first measurement of scoring
quality this project has.
