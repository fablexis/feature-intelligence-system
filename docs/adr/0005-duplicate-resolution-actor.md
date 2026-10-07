# ADR 0005 — Who resolves a duplicate suggestion: submitter vs. PM

**Status:** accepted · **Date:** 2026-10-07 · **Resolves:** [PRODUCT open question 1](../PRODUCT.md#open-questions-for-the-plan-phase)

## Context

The most sensitive UX decision in the product. Three facts pull against each other: the submitter has ~60 seconds and wants to be finished; the PM owns correctness but is not present at submit time; and a **false merge is the expensive, near-undetectable error** (PRODUCT challenge #3).

## Decision

Split by confidence band, with an escape hatch.

- **At or above `T_auto`, verdict `same`** → auto-attach. The submitter sees "joined 23 others" plus the problem's evidence, and a one-click **"actually, mine is different"** that creates a new problem and records the disagreement in `dedupe_suggestions`.
- **Between `T_ask` and `T_auto`** → show candidates; the submitter may attach, or choose "not sure", which creates the problem flagged for PM review.
- **Below `T_ask`** → create new, silently.

The PM reviews a filtered queue: low-margin auto-attaches plus submitter-flagged items.

## Alternatives

- **PM resolves everything** — safest for precision, but it destroys the intake-moment value that justifies the entire design. The submitter gets nothing back and reverts to Slack.
- **Submitter resolves everything** — fastest, but the submitter is the party least able to judge whether two problems are the same and the most motivated to believe theirs is special.

## Consequences

**The escape hatch is load-bearing.** It converts a false merge from invisible to self-reporting, which is the only cheap detector for an error class PRODUCT calls near-undetectable — and it generates labelled disagreement data for free. It requires merges to be reversible (`evidence_links.active`). It adds a PM review queue, which is scope: in core that is a filtered view on the problem list, not a separate screen.
