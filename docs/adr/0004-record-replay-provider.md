# ADR 0004 — Record/replay provider for the keyless path

**Status:** accepted · **Date:** 2026-10-07 · **Supersedes:** the synthetic-mock design in the original [D5](../PRODUCT.md#d5-revised--recordreplay-not-synthetic-embeddings)

## Context

A reviewer must be able to run the project with no API key. The original plan was a deterministic mock using hashed character n-gram embeddings. That design **fails the product**: determinism is not capability. N-gram similarity cannot match "add CSV export" to "finance can't get the numbers into Excel" — the two share nothing beyond noise. The keyless path, which is the one most likely to be exercised, would have failed on exactly the planted duplicates that exist to prove the thesis, demonstrating the opposite of the central claim.

## Decision

A **record/replay** provider. A record script runs the real Gemini provider once over the seed corpus and the scripted demo request, capturing embeddings, extractions and adjudication verdicts into committed JSON under `fixtures/`, keyed by `sha256(stage + model_id + prompt_version + normalized_input)`. The replay provider serves those fixtures, so with no key the full pipeline runs on **real model outputs** — genuine semantic matching, deterministic, offline, free. Novel input falls back to hashed n-grams at a conservative threshold, **labeled in the UI as degraded**.

## Alternatives

- **Synthetic deterministic mock** — rejected above.
- **Require an API key** — reviewer friction plus unknown free quota ([ADR 0001](./0001-llm-provider.md)).
- **Bundle a local embedding model (transformers.js)** — genuinely semantic for novel input and the better long-term answer, but tens of megabytes of weights and real build complexity inside a 3-hour budget. Deferred, not dismissed.

## Consequences

Fixtures cover recorded inputs only; free-typed novel input degrades and says so rather than silently returning a worse answer dressed as the real one. The prompt version in the hash key means a prompt change invalidates fixtures loudly instead of silently measuring stale behaviour. Secondary benefit: fixtures make M1's precision/recall **reproducible** — without them the number drifts between runs on model nondeterminism and means nothing.
