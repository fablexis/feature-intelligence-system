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
