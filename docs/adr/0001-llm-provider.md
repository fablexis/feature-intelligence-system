# ADR 0001 — LLM provider: Gemini via the Vercel AI SDK

**Status:** accepted · **Date:** 2026-10-07 · **Relates to:** [D5](../PRODUCT.md#recorded-decisions), [ADR 0004](./0004-record-replay-provider.md)

## Context

The system needs four model capabilities: problem extraction, text embeddings, duplicate adjudication, and factor estimation. Two constraints dominate, and the first is not technical: **there is no API budget**, and a reviewer must be able to run the project for free. Everything else is secondary.

## Decision

Google Gemini via the Vercel AI SDK, behind a four-method `AiProvider` interface. Tiers are environment variables, never literals in code:

- `GEMINI_MODEL_FAST=gemini-3.8-flash` — stable; extraction
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
