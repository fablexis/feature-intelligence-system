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

## 2026-10-07 — Canonical ingest pass, **v1** (C3)

**Superseded by v2 below.** Kept because the iteration is the point: the eval
found a prompt defect, the prompt changed, and the numbers moved. Deleting the
"before" would hide the only evidence that the loop works.

**Adjudication prompt:** `v1-b492db6f`
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

## 2026-10-07 — Canonical ingest pass, **v2** (C3, after the prompt fix)

**Adjudication prompt:** `v1-76fa765d` (was `v1-b492db6f`)
**Basis:** same 55 requests, same corpus, same `T_auto` 0.8, 54 fresh
adjudication calls. Only the adjudication prompt changed.

| metric | v1 | **v2** | |
|---|---|---|---|
| all-band precision | 0.974 | **1.000** | ↑ |
| all-band recall | 0.319 | **0.466** | ↑ 46% |
| auto-band precision | 1.000 | **1.000** | — |
| auto-band recall | 0.233 | **0.333** | ↑ |
| problems formed (truth 12) | 31 | **23** | ↓ |
| planted disjoint pairs caught | 6/11 | **8/11** | ↑ |
| **related-but-distinct wrongly merged** | 1/3 | **0/3** | ↓ |
| false merges, whole corpus | 1 | **0** | ↓ |

**The fix did not trade recall for false merges — it improved both.** Recall
rose 46% while precision rose to 1.000 and the counter-risk went the right way:
v1's single false merge (`r03a/r09a`, approval controls vs. approve-from-email)
is gone, and all three related-but-distinct pairs stayed distinct.

That the two moved together is the useful signal. A prompt that splits genuine
duplicates on wording is not being *cautious* — it is being inaccurate, and it
was getting the adjacent pairs wrong too.

### The two changes, and why each follows from the definition

Made without consulting the labels, and justified by what a duplicate *is*:

1. **Removed "same cause, different scope" from the `related` definition.** The
   clause contradicted the definition it sat under: `related`'s primary test is
   "solving one would not resolve the other", and if the cause is the same then
   one fix resolves both. "Scope" is also unbounded — any two descriptions of
   one situation differ in scope at some zoom level — so the clause licensed
   arbitrary splitting. Replaced with the causal test plus an explicit
   statement that a difference in level of description is not a difference in
   problem.
2. **Replaced the "when torn, answer `related`" tie-break.** It rested on a
   false premise: that a `same` verdict causes a silent merge. It does not —
   the system flags an uncertain `same` for a PM. So the prompt was being asked
   to guard something already guarded, and the bias cost information that
   cannot be recovered downstream (a `related` verdict removes the pair from
   review entirely). Replaced with the mechanism it actually faces: report the
   relation you believe, carry uncertainty in `confidence`, because confidence
   is the dial that decides how much human review the verdict gets.

Corroboration, not the basis: every v1 miss returned `related` at 0.85 and
separated the pair with the words "broader", "specifically" or "rather than" —
the signature of a wording difference, not a problem difference.

### KNOWN GAP — recall 0.466 vs. the 0.60 target · *next with more time*

**Shipped at 0.466 against a pre-registered ≥ 0.60.** Recorded as a known gap
rather than quietly dropped, and not iterated on further. Three planted pairs
remain missed — `r02a/r02b`, `r05a/r05b`, `r11a/r11b` — and 23 problems formed
against a ground truth of 12, so the pipeline still over-splits.

**Why shipping at 0.466 is the right call here, not a concession.** The error
asymmetry runs the other way for recall. A missed duplicate is a **false
split**: two similar problems sit in the list, a human sees them, and a later
merge fixes it. A false merge is invisible and silently corrupts every
downstream score. This build protects the expensive side and does so
completely — **auto-band precision 1.000, zero false merges in the whole
corpus**. Trading that for recall would be trading the error we cannot detect
for the one we can.

**Diagnosis: abstraction level, in extraction rather than adjudication.** The
v2 adjudication prompt is no longer the binding constraint — it now applies the
causal test correctly on 8 of 11 planted pairs. The remaining misses are pairs
whose *extracted statements* already sit at different zoom levels before
adjudication sees them, so the adjudicator is being asked to reunify something
the earlier stage pulled apart. `prompts/extract.md` pins abstraction level by
anchoring on `currentWorkaround`, and that anchor is evidently not tight enough
for these three.

**Next lever, and its real cost.** Tighten the extraction prompt's
abstraction-level rule — most promisingly by constraining `currentWorkaround`
to a concrete physical action, which is what stops the statement drifting up or
down the zoom axis. That changes the extraction prompt's content hash, which
invalidates **all 56 extractions, all 56 embeddings** (they key on the
extracted text) **and all 109 adjudications** — roughly 165 fixtures, against
a daily cap that is still unmeasured on two of the three models. Not worth
spending inside this appetite; it is the first thing to do with a fourth hour
and a known quota.

**Measurable consequence to carry forward:** the gap understates the reach of
the most widely-felt problem, because notification scoping fragments across
four problems instead of one. See [DEMO.md](./DEMO.md) Beat 2, which states the
formed numbers rather than the intended ones.

### The scripted demo request

Recorded against the v2 problem set, so the Loom path runs with no API key:

- **Extracted:** "The manual entry of financial data from Ledgerline into the
  accounting system is time-consuming and error-prone." (confidence 1.0, not
  degraded)
- **Resolves to** `prob-req-r01b` — *"cannot automatically transfer billing data
  from the revenue-operations platform to their accounting general ledger"* —
  the correct problem
- **Verdict `same` at confidence 0.99**, cosine 0.822, score 0.822 vs `T_auto`
  0.8, so it **auto-attaches**: no human confirmation needed
- Rationale shown in the UI: *"Both describe the exact same underlying problem
  of lacking automated data transfer from the platform into an accounting
  general ledger system."*
- Across 23 candidates: 1 `same`, 1 `related`, 21 `distinct`

All with **zero content words in common** with any request on that problem.

---

## Pending — threshold sweep (C7)

Will record here: the chosen `T_auto`, the precision/recall curve it came from,
and the sweep's one remaining approximation (verdicts were produced with all
candidates visible, so a production top-*k* would be slightly off-context —
see [ADR 0003](./adr/0003-brute-force-cosine.md)'s breadth trigger).
