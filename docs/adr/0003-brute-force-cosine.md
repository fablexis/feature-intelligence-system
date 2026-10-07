# ADR 0003 — Brute-force cosine in SQLite, with a named scaling path

**Status:** accepted · **Date:** 2026-10-07 · **Relates to:** [D4](../PRODUCT.md#recorded-decisions), [ADR 0002](./0002-two-stage-dedupe.md)

## Context

Stage 1 of the dedupe pipeline needs nearest-neighbour search over problem embeddings. The stack is SQLite + Drizzle ([D4](../PRODUCT.md#recorded-decisions)), and **SQLite has no native vector index**. The corpus is ~12 problems seeded, a few hundred at demo scale.

## Decision

Store each problem's embedding as a `BLOB` (`Float32Array`) on `problems`. On query, load all problem vectors and compute cosine similarity in-process in Node. Retrieval is isolated behind `lib/retrieval/`.

## Alternatives

- **`sqlite-vec` extension** — a real index, but a native extension to load and build, with install friction for the reviewer and no measurable benefit at this scale. Premature.
- **Postgres + pgvector** — correct at scale, wrong for a zero-setup local demo.
- **Precomputed similarity matrix** — stale the moment a problem is created, which is every submission.

## Consequences

At a few hundred problems a full scan is sub-millisecond, so this is not a compromise at current scale — it is the right answer. Cost is linear in problem count and the real ceiling is memory: 10k problems × 3072 dims × 4 bytes ≈ **123 MB** resident.

**Scaling trigger, named now so it isn't argued later:** migrate to a real index when problem count exceeds ~10k *or* p95 retrieval exceeds 100ms, whichever comes first. Note the trigger is *problem* count, not request count — evidence links are unbounded and irrelevant here. Because retrieval lives in one module, the migration is one file plus a backfill.
