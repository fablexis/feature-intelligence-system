# Eval Results

Measurements, with the date and the basis. Nothing here is asserted from
reasoning — if it is in this file, it was computed.

---

## 2026-10-07 — Embedding stage, after C2 fixture recording

**Basis:** 56 extractions and 56 embeddings recorded from
`gemini-3.1-flash-lite` / `gemini-embedding-001` at 768 dims, replayed offline
with zero API calls. Reproduce with `npm run verify:replay`.

### The scripted demo request resolves correctly

The demo request shares **zero content words** with any of the seven requests on
its target problem (machine-checked in `src/seed/seed.test.ts`). Nearest
neighbours by cosine over the extracted problem statement:

| cosine | request | problem |
|---|---|---|
| 0.822 | r01b | **P01_LEDGER_SYNC** ✓ |
| 0.813 | r01f | **P01_LEDGER_SYNC** ✓ |
| 0.785 | r01d | **P01_LEDGER_SYNC** ✓ |
| 0.740 | r01g | **P01_LEDGER_SYNC** ✓ |
| 0.739 | r05d | P05_FX_AT_CLOSE |

The top four are all the correct problem. Every lexical method — keyword,
trigram, tag taxonomy, full-text search — returns nothing on this input.

Note how thin the 4th/5th margin is: **0.740 against 0.739**. One point of
cosine separates a correct match from a different problem.

### All 11 planted disjoint pairs score high

Mean **0.812**, min **0.741**. Paraphrase matching across disjoint vocabulary
works, which is the capability the whole project rests on.

### The measured reason adjudication exists

This is the evidence for the two-stage design, and the single most load-bearing
number in the project: **cosine alone cannot decide identity.**

| set | n | mean | extreme |
|---|---|---|---|
| planted duplicates (same problem, no shared words) | 11 | 0.812 | **min 0.741** |
| related-but-distinct (adjacent problems) | 3 | 0.723 | **max 0.772** |

**Separation: −0.031.** The *worst* true duplicate (`r06a/r06b`, SSO/SCIM vs.
offboarding risk, 0.741) scores **lower** than the *best* adjacent-but-distinct
pair (`r01a/r07a`, ledger re-entry vs. dimensional reporting, 0.772).

So the two classes **overlap**: no single cosine threshold separates them on
this corpus. A threshold at 0.75 would merge `r01a/r07a` — a false merge, the
expensive and near-undetectable error — while still missing `r06a/r06b`.

This is [ADR 0002](./adr/0002-two-stage-dedupe.md)'s premise measured rather
than argued: embeddings are a recall instrument, and identity is a semantic
judgement that needs the adjudication pass. It also settles a design question
directly — **problem formation cannot be driven by a similarity threshold**,
because on this data no such threshold exists.

---

## 2026-10-07 — Canonical ingest pass (C3)

**Basis:** 55 requests through the full pipeline, 52 live adjudication calls,
`T_auto` 0.8 (placeholder). Scored **pairwise** against the labels: for each
pair of requests, did the pipeline group them, and should it have?

| band | precision | recall | tp / fp / fn |
|---|---|---|---|
| all bands | 0.974 | 0.319 | 37 / 1 / 79 |
| **auto band only** | **1.000** | 0.233 | 24 / 0 / 79 |

**Replay reproduces the pass exactly** — 31 problems, 24 attached, 8 flagged,
0 degraded, zero API calls. That determinism is what makes a confirming pass
free.

### Against the pre-registered targets

- **Precision ≥ 0.90 — met, and then some.** 1.000 in the auto band: *zero*
  false merges where no human would have been asked. The single false merge in
  the corpus (`r03a/r09a`, approval controls vs. approve-from-email) landed in
  the **flagged** band, which is the band existing to catch exactly that.
- **Recall ≥ 0.60 — missed badly, at 0.319.** 31 problems formed where ground
  truth is 12. Six of eleven planted disjoint pairs were caught, including the
  hardest one (`r06a/r06b` at cosine 0.741, *below* the best non-duplicate —
  cosine alone could never have found it).

### Diagnosed cause: two clauses in the adjudication prompt

All five missed pairs returned **`related` at confidence 0.85** — not
`distinct`. The model recognised the shared problem and then split on *scope*:

> "both deal with tracking document changes, but `prob-req-r02a` addresses user
> attribution whereas the new problem concerns a broader immutable audit trail"

That is one problem described at two zoom levels, which the extraction prompt's
abstraction-level rule was supposed to normalise. Across 991 judgements:
**895 `distinct`, 72 `related`, 24 `same`.**

Two clauses in `prompts/adjudicate.md` produced it:

1. *"when you are genuinely torn between `same` and `related`, answer
   `related`"* — followed faithfully, and 0.85 confidence shows the model
   wasn't torn at all; it was confidently choosing `related`.
2. The `related` definition permits *"same cause, different scope"*. **"Scope"
   is the loophole**: every paraphrase pair differs in scope at some level of
   description, so the clause licenses splitting genuine duplicates.

The existing counter-test — *"would one change ship for both?"* — is present in
the prompt but overridden by clause 1.

**Lever and its cost:** recall here is *not* recoverable by C7's sweep. Under
formation-by-verdict, `T_auto` moves items between the auto and flagged bands
but never changes formation, so recall is frozen by the recorded verdicts. This
is the flip side of the exactness that design bought: the sweep trades
auto-precision against review load, and nothing else. Improving recall means
editing the prompt, which changes its content hash and invalidates all 52
adjudication fixtures.

---

## Pending — threshold sweep (C7)

Will record here: the chosen `T_auto`, the precision/recall curve it came from,
and the sweep's one remaining approximation (verdicts were produced with all
candidates visible, so a production top-*k* would be slightly off-context —
see [ADR 0003](./adr/0003-brute-force-cosine.md)'s breadth trigger).
