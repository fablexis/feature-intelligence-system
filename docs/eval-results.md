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

### The finding that matters: cosine alone cannot decide identity

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

## Pending — dedupe precision/recall sweep (C7)

Requires C3's pipeline. Will record here: the chosen `T_auto`, the
precision/recall curve it came from, stage-1 recall measured separately from
end-to-end precision, and the sweep's documented approximations.
