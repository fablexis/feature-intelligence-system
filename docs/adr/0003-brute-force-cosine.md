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

## A second trigger: retrieval breadth, not just retrieval speed

Retrieval currently returns **every** problem rather than a top-*k*, which is
what makes C7's threshold sweep exact — there are no unretrieved pairs the
sweep could never evaluate. At ~12 problems that is free.

It does not scale, and the binding constraint is **not** the cosine scan. It is
that the adjudication prompt grows with the problem count: every candidate
costs tokens in a single call, so breadth converts directly into prompt size,
latency and cost. Well before the 10k index trigger above, the prompt becomes
the limit.

**Switch to top-*k* retrieval when candidate count exceeds ~25 per request, or
when the adjudication prompt exceeds ~40% of the model's context.** Two
obligations come with that switch:

1. **Stage-1 recall must then be measured separately** from end-to-end
   precision ([ADR 0002](./0002-two-stage-dedupe.md)), because a true duplicate
   outside the top *k* is unrecoverable no matter how good adjudication is, and
   that ceiling would otherwise be misread as an adjudication failure.
2. **The threshold sweep stops being exact.** Once candidates are truncated,
   recorded tuples no longer cover every pair, so the sweep becomes an
   approximation over whatever was retrieved — the very thing choosing breadth
   avoided here.
