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
