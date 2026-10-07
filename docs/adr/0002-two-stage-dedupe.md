# ADR 0002 — Two-stage dedupe: embedding recall → LLM adjudication

**Status:** accepted · **Date:** 2026-10-07 · **Relates to:** [D1](../PRODUCT.md#recorded-decisions), [PRODUCT challenge](../PRODUCT.md#challenge-to-the-thesis)

## Context

The centerpiece must match problems stated in **lexically disjoint vocabulary**. It must also distinguish *same problem* from *adjacent problem* — and that distinction is semantic, not geometric. Cosine distance in embedding space collapses "export to CSV" and "export to PDF" to nearly the same point while treating them as equivalent, which is exactly the false merge the design most needs to avoid.

## Decision

Two stages per submission:

1. **Recall** — embed the extracted problem, brute-force cosine over existing problem vectors, take top *k* = 8 (`config/thresholds.json`).
2. **Precision** — one LLM call adjudicating all *k* candidates together, returning `{ problem_id, relation: same|related|distinct, confidence, rationale }` per candidate.

Stage 1 is cheap and generous; stage 2 is the judgment. Thresholds are applied deterministically afterwards ([ARCHITECTURE](../ARCHITECTURE.md#pipeline) stage 5).

## Alternatives

- **Embedding-only with a tuned threshold** — one call, fast, and the precision ceiling is lowest precisely where errors are most expensive. Rejected.
- **LLM pairwise over every problem** — best precision, O(*n*) calls per submission. Blows the latency budget and the free quota.
- **Offline clustering (HDBSCAN et al.)** — batch-shaped. It doesn't answer "is this new?" *at intake*, which is the one moment deduplication is free.

## Consequences

Two model calls, ~6.5s of the intake budget. The `rationale` string is a product asset, not debug output — it satisfies the "explains itself" acceptance property. **Recall is capped by stage 1:** a true duplicate outside the top 8 is unrecoverable, so the eval must report **stage-1 recall separately** from end-to-end precision, or a recall ceiling will be misread as an adjudication failure.
