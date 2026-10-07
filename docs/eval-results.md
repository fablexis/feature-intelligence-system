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

**The numbers for this run, and the v1 → v2 comparison, are computed by the C7
harness** — see the generated section at the end of this file. They used to be
hand-typed here; a results file whose figures are transcribed by hand can drift
from the run that produced them, and this one had (the auto-band recall below
was computed on a mixed denominator, which the harness corrects).

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

<!-- eval:begin — generated by `npm run eval`; edits inside are overwritten -->

## 2026-10-07 — Threshold sweep and current metrics (C7)

Everything in this section is **generated by `npm run eval`**. Nothing here is
hand-typed, so no figure can drift from the run that produced it. The analysis
sections above and below are hand-written; the numbers are not.

### How this run was produced

| | |
|---|---|
| provider | `replay` — **0 API calls**, `fetch` disabled in-process |
| corpus | 55 seeded requests, 12 labelled problems |
| prompts | extract `v1-e3d0a802` · adjudicate `v1-76fa765d` · embed `embed-v1` |
| fixtures recorded | 2026-10-07T05:11:04.085Z |
| degraded stages | 0 — a non-zero count means stale fixtures, and fails the run |
| metric | pairwise over 1485 request pairs; 116 of them are true duplicates |

The pipeline is re-run end to end from fixtures into a throwaway in-memory
database, so the measurement neither depends on nor disturbs `data/fis.db`.
The sweep then replays **stage 5 only**, over the exhaustively recorded
`(request, candidate, verdict, confidence, similarity)` tuples.

### Current build at the configured thresholds (T_ask 0.00, T_auto 0.80)

| band | precision | recall | F1 | tp / fp / fn / tn |
|---|---|---|---|---|
| all bands | **1.000** | **0.466** | 0.635 | 54 / 0 / 62 / 1369 |
| auto band only | **1.000** | 0.267 | 0.422 | 31 / 0 / 85 / 1369 |

Problems formed: **23** against a ground truth of 12. 32 requests attached (21 auto, 11 flagged for a PM — 34% review load), 23 formed a new problem.

Planted disjoint pairs caught: **8/11** (missed req-r02a/req-r02b, req-r05a/req-r05b, req-r11a/req-r11b). Related-but-distinct pairs wrongly merged: **0/3**.

Verdict mix across all 821 recorded tuples: 37 `same`, 51 `related`, 733 `distinct`.

> **Band denominators.** Both rows above are scored on the same
> 116 true pairs. Earlier hand-computed auto-band recall in this file
> divided an auto-band numerator by an all-band denominator, which inflates it;
> the harness does not.

### v1 → v2, all-band

| metric | v1 (`v1-b492db6f`) | current (`v1-76fa765d`) | |
|---|---|---|---|
| precision | 0.974 | **1.000** | ↑ |
| recall | 0.319 | **0.466** | ↑ |
| true merges (tp) | 37 | **54** | ↑ |
| false merges (fp) | 1 | **0** | ↓ |
| problems formed (truth 12) | 31 | **23** | ↓ |
| planted pairs caught | 6/11 | **8/11** | ↑ |
| related pairs merged | 1/3 | **0/3** | ↓ |

v1's figures are **quoted from its published run**, not recomputed: a fixture key
includes the prompt's content hash, so reproducing them means reverting
`prompts/adjudicate.md`. See `src/eval/history.ts` for the provenance.

### Stage-1 recall ceiling, reported separately

ADR 0002 requires this to be separate from end-to-end precision, so a
retrieval ceiling is never misread as an adjudication failure. For each true
pair, could retrieval put the earlier request’s problem in front of the
adjudicator at all?

| retrieval breadth | pairs reachable | ceiling |
|---|---|---|
| top-4 | 115/116 | 0.991 |
| top-8 | 116/116 | 1.000 |
| top-12 | 116/116 | 1.000 |
| top-16 | 116/116 | 1.000 |
| **all problems** (shipped) | 116/116 | 1.000 |

The shipped breadth imposes **no ceiling at all**, which is the point of
`candidateLimit: "all"`: every miss below is adjudication's, not retrieval's.
The top-*k* rows hold this run's formation fixed and are the measured input to
[ADR 0003](./adr/0003-brute-force-cosine.md)'s breadth trigger — the cost of
narrowing retrieval when the adjudication prompt stops fitting the problem count.

### Which signal `T_auto` actually tests

`autoScore` is `min(confidence, similarity)`. Across all 37 `same` verdicts, similarity is the binding term **37 times** and confidence **0**: confidence ranges 0.850–1.000 while similarity ranges 0.741–0.915, so the minimum is **always** the cosine.

`T_auto` is therefore a cosine cut in disguise, and the scores it cuts (0.741–0.915) straddle the band C2 measured as
unseparable — worst true duplicate 0.741 below best adjacent-but-distinct
0.772. That is a structural reason this corpus cannot calibrate `T_auto` by
similarity, independent of the sweep below: the threshold is being asked to
discriminate using the one signal already measured as unable to.

C2 measured that overlap over 14 hand-picked request pairs. Every one of the
821 recorded tuples is a (request, problem) comparison whose ground truth
is known, so it can be remeasured over all of them — at the level `T_auto`
actually operates on:

| cosine between a request and… | min | max |
|---|---|---|
| …a problem genuinely its own | **0.676** | 0.915 |
| …a problem from another true cluster | 0.519 | **0.783** |

Separation: **-0.107** — the classes overlap at problem level too.
This gives the one constraint the corpus *does* place on `T_auto`: above
**0.783**, no auto-attach can land at a cosine where a known
non-duplicate also sits. Below it, the system would be acting unattended
inside the band where cosine is demonstrably uninformative. The
pre-registered rule contains no such clause — it is reported here because it
is measured, and it is why the adopted value is the lowest grid point above
that line rather than the lowest grid point overall.

### The sweep — every (T_ask, T_auto) pair on the grid

Grid: 0.00, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95. Cells with `T_ask > T_auto` are omitted:
they would auto-attach below the floor at which anything is asked.

| T_ask | T_auto | all: P | all: R | all tp/fp/fn/tn | auto: P | auto: R | auto tp/fp/fn/tn | problems | flagged | blind spot |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.00 | 0.00 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 23 | 0 | exact |
| 0.00 | 0.70 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 23 | 0 | exact |
| 0.00 | 0.75 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.431 | 50 / 0 / 66 / 1369 | 23 | 2 | exact |
| 0.00 | 0.80 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.267 | 31 / 0 / 85 / 1369 | 23 | 11 | exact |
| 0.00 | 0.85 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.078 | 9 / 0 / 107 / 1369 | 23 | 26 | exact |
| 0.00 | 0.90 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.017 | 2 / 0 / 114 / 1369 | 23 | 30 | exact |
| 0.00 | 0.95 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | — | 0.000 | 0 / 0 / 116 / 1369 | 23 | 32 | exact |
| 0.70 | 0.70 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 23 | 0 | exact |
| 0.70 | 0.75 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.431 | 50 / 0 / 66 / 1369 | 23 | 2 | exact |
| 0.70 | 0.80 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.267 | 31 / 0 / 85 / 1369 | 23 | 11 | exact |
| 0.70 | 0.85 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.078 | 9 / 0 / 107 / 1369 | 23 | 26 | exact |
| 0.70 | 0.90 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | 1.000 | 0.017 | 2 / 0 / 114 / 1369 | 23 | 30 | exact |
| 0.70 | 0.95 | 1.000 | 0.466 | 54 / 0 / 62 / 1369 | — | 0.000 | 0 / 0 / 116 / 1369 | 23 | 32 | exact |
| 0.75 | 0.75 | 1.000 | 0.431 | 50 / 0 / 66 / 1369 | 1.000 | 0.431 | 50 / 0 / 66 / 1369 | 25 | 0 | 2 unseen |
| 0.75 | 0.80 | 1.000 | 0.431 | 50 / 0 / 66 / 1369 | 1.000 | 0.267 | 31 / 0 / 85 / 1369 | 25 | 9 | 2 unseen |
| 0.75 | 0.85 | 1.000 | 0.431 | 50 / 0 / 66 / 1369 | 1.000 | 0.078 | 9 / 0 / 107 / 1369 | 25 | 24 | 2 unseen |
| 0.75 | 0.90 | 1.000 | 0.431 | 50 / 0 / 66 / 1369 | 1.000 | 0.017 | 2 / 0 / 114 / 1369 | 25 | 28 | 2 unseen |
| 0.75 | 0.95 | 1.000 | 0.431 | 50 / 0 / 66 / 1369 | — | 0.000 | 0 / 0 / 116 / 1369 | 25 | 30 | 2 unseen |
| 0.80 | 0.80 | 1.000 | 0.267 | 31 / 0 / 85 / 1369 | 1.000 | 0.267 | 31 / 0 / 85 / 1369 | 34 | 0 | 11 unseen |
| 0.80 | 0.85 | 1.000 | 0.267 | 31 / 0 / 85 / 1369 | 1.000 | 0.078 | 9 / 0 / 107 / 1369 | 34 | 15 | 11 unseen |
| 0.80 | 0.90 | 1.000 | 0.267 | 31 / 0 / 85 / 1369 | 1.000 | 0.017 | 2 / 0 / 114 / 1369 | 34 | 19 | 11 unseen |
| 0.80 | 0.95 | 1.000 | 0.267 | 31 / 0 / 85 / 1369 | — | 0.000 | 0 / 0 / 116 / 1369 | 34 | 21 | 11 unseen |
| 0.85 | 0.85 | 1.000 | 0.078 | 9 / 0 / 107 / 1369 | 1.000 | 0.078 | 9 / 0 / 107 / 1369 | 49 | 0 | 26 unseen |
| 0.85 | 0.90 | 1.000 | 0.078 | 9 / 0 / 107 / 1369 | 1.000 | 0.017 | 2 / 0 / 114 / 1369 | 49 | 4 | 26 unseen |
| 0.85 | 0.95 | 1.000 | 0.078 | 9 / 0 / 107 / 1369 | — | 0.000 | 0 / 0 / 116 / 1369 | 49 | 6 | 26 unseen |
| 0.90 | 0.90 | 1.000 | 0.017 | 2 / 0 / 114 / 1369 | 1.000 | 0.017 | 2 / 0 / 114 / 1369 | 53 | 0 | 30 unseen |
| 0.90 | 0.95 | 1.000 | 0.017 | 2 / 0 / 114 / 1369 | — | 0.000 | 0 / 0 / 116 / 1369 | 53 | 2 | 30 unseen |
| 0.95 | 0.95 | — | 0.000 | 0 / 0 / 116 / 1369 | — | 0.000 | 0 / 0 / 116 / 1369 | 55 | 0 | 32 unseen |

**`T_auto` rows are exact.** Under formation-by-verdict it moves an attach
between the auto and flagged bands and never changes which problems exist, so
each row is behaviour the system would really have.

**`T_ask` rows above 0 are counterfactual, and the "blind spot" column prices
the approximation.** `resolve()` has no `T_ask` parameter: formation follows the
adjudicator's verdict, per [ADR 0002](./adr/0002-two-stage-dedupe.md)'s amendment.
Raising it can only turn an attach into a new problem, so every problem the
canonical pass formed still exists and every recorded verdict still applies —
but the *extra* problems were never offered to the requests that arrived after
them, and that count is the blind spot. At `T_ask = 0` it is zero and the sweep
is exact.

### What `T_auto` costs and buys

At `T_ask 0.00`, the only axis `T_auto` moves is how much of the work a
human is asked to confirm:

| T_auto | auto attaches | flagged | review load | auto-band precision | auto-band recall |
|---|---|---|---|---|---|
| 0.00 | 32 | 0 | 0% | 1.000 | 0.466 |
| 0.70 | 32 | 0 | 0% | 1.000 | 0.466 |
| 0.75 | 30 | 2 | 6% | 1.000 | 0.431 |
| 0.80 | 21 | 11 | 34% | 1.000 | 0.267 |
| 0.85 | 6 | 26 | 81% | 1.000 | 0.078 |
| 0.90 | 2 | 30 | 94% | 1.000 | 0.017 |
| 0.95 | 0 | 32 | 100% | — | 0.000 |

### The selection rule, applied

Fixed in advance ([ARCHITECTURE](./ARCHITECTURE.md#choosing-thresholds-from-the-eval)):
**the lowest `T_auto` whose auto-merge precision ≥ 0.90, then the
lowest `T_ask` keeping recall ≥ 0.60.** A `T_auto` is judged at the
lowest `T_ask`, which is the most permissive formation and so the hardest
precision test it faces.

**Literal output of the rule: `T_ask 0.00`, `T_auto 0.00`.**

| constraint | status |
|---|---|
| auto-merge precision ≥ 0.90 | **non-binding** — every cell on the grid clears it, so it selected nothing |
| recall ≥ 0.60 | **unsatisfiable** — the best recall anywhere on the grid is 0.466 |

A `—` in an auto-band precision column is an **empty auto band**, not a
failure: a `T_auto` above every recorded score auto-attaches nothing, so
precision there is undefined. Those cells are excluded from the constraint
rather than counted as breaches, which is what makes the verdict above honest.

Both clauses failed to bite, which is itself this run's principal finding about
the *rule*. It was written expecting precision to decay as `T_auto` falls. It
does not: the adjudicator makes **0 false merges anywhere in the corpus**, so
every operating point has precision 1.000 and "the lowest `T_auto` that keeps
precision" degenerates to the lowest value on the grid — i.e. ask no human at all,
which is the posture [ADR 0005](./adr/0005-duplicate-resolution-actor.md) exists to reject.

The sample says why the rule cannot do better here. Zero false merges in
32 attaches bounds the per-attach false-merge rate at **≤ 9% with 95%
confidence** (rule of three). A floor of 0.90 is *consistent with* that
bound, not *certified* by it — so adopting the rule's literal output would remove
all human review on evidence that barely clears the bar it is being tested against.

**Adopted in `config/thresholds.json`: `T_auto 0.80`** — not the rule’s literal output. Basis recorded in that file:

> C7 sweep, 2026-10-07. The pre-registered rule (lowest T_auto with auto-merge precision >= 0.90) degenerated: v2 makes zero false merges at every operating point, so the constraint separated nothing and the rule's literal answer was the grid floor — i.e. never ask a human, which ADR 0005 exists to reject. Zero false merges in 32 attaches bounds the error rate at ~9% (95%), wider than the floor's own headroom, so the data is consistent with 0.90 rather than certifying it. 0.80 is retained on the one constraint the corpus does supply: across all 821 labelled tuples, cosines between a request and a problem from a different true cluster reach 0.783, so only above that line can an unattended merge land where no known non-duplicate also sits. 0.80 is the lowest grid point above 0.783; 0.75 would auto-attach inside the contested band. Full derivation in docs/eval-results.md.

### Hard floor

Floor: auto-merge precision ≥ 0.75. Measured at the configured
thresholds: **1.000** — pass, so the harness reports and exits 0.
Per [PRODUCT open question 3](./PRODUCT.md#open-questions-for-the-plan-phase) the
harness reports rather than gates in the core build; full gating is [E4](./TASKS.md#e4--ci-with-mock-mode-tests-and-evals).
A degraded stage also fails the run, because a degraded stage is not a measurement.

<!-- eval:end -->

---

## Reading the generated section (C7)

The block above is rewritten by `npm run eval` on every run. Two things about it
are worth saying once, in prose, because they are judgements rather than
measurements:

**The selection rule degenerated, and the thresholds are not calibrated by this
corpus.** The rule was pre-registered expecting a trade-off: push `T_auto` down
until precision starts to fail. On this corpus precision never fails — the v2
adjudicator produces zero false merges at every operating point — so the rule's
literal answer is the lowest `T_auto` on the grid, which means *never ask a
human*. That is the posture [ADR 0005](./adr/0005-duplicate-resolution-actor.md)
exists to reject, and the sample cannot support it: the generated block carries
the rule-of-three bound on the false-merge rate after a clean run, and it is
wider than the headroom the 0.90 floor leaves. The floor is *consistent with*
the data, not *certified* by it.

So `config/thresholds.json` keeps `T_auto` at 0.80 — **sweep-informed rather
than sweep-selected**, with the reason recorded in the file itself. This is the
one place the pre-registered rule's output was not adopted, and it is recorded
here rather than quietly applied.

The value is not a hunch, though. The rule's precision constraint is silent
here, but the *similarity distribution* is not: remeasuring C2's overlap over
every recorded tuple marks a band in which cosine is demonstrably unable to tell
a duplicate from a neighbour, and the generated section computes where that band
ends. The adopted `T_auto` is the lowest grid point above it — so an unattended
merge never happens at a cosine that a known non-duplicate also reaches. The
grid point below would. That is the one calibration this corpus can support, and
it is a weaker claim than the pre-registered rule wanted to make: it bounds
where auto-attaching is defensible rather than finding where precision breaks. A
corpus large enough to produce a false merge somewhere would calibrate it
properly; this one is not that corpus.

**`T_ask` stays 0, and the sweep is how we know it should.** The non-zero rows
show it buying nothing: precision is already 1.000 without it, so every rise in
`T_ask` costs recall and returns no precision. That is the measured form of
[ADR 0002](./adr/0002-two-stage-dedupe.md)'s amendment — formation follows the
adjudicator's verdict, not a similarity threshold — and it is why `resolve()` has
no `T_ask` parameter to set. The sweep prices the counterfactual; it is not a
knob waiting to be turned.
