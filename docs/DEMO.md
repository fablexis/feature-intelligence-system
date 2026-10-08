# Demo Path

The five minutes a reviewer should watch. Every number below comes from the
seeded corpus — nothing here is staged at demo time except the one request you
type yourself.

**Setup** — the [README quickstart](../README.md#keyless-quickstart--no-api-key-no-network) is
the authoritative copy; this is the same sequence.

```bash
npm install
npm run demo:reset      # migrate + seed + ingest + score, then asserts the canonical counts
npm run dev
```

`demo:reset` replaces the four-step sequence below and is also how you get back
to this state between takes — it clears the tables **in place**, so it is safe to
run while `npm run dev` is up. The long form, if you want to watch each step:

```bash
npm install
npm run db:migrate
npm run seed            # 22 accounts, 55 requests, 0 problems
npm run verify:replay   # proves the keyless path serves real model output — 56/56
npm run ingest          # forms the 23 problems. REQUIRED: seeding creates none
npm run score           # factor estimates and bands, or /priority is empty
npm run dev
```

No API key and no `.env` needed. The fixture provider replays real Gemini
outputs recorded over this corpus ([ADR 0004](./adr/0004-record-replay-provider.md)),
and `verify:replay` fails loudly if any input would silently fall back to the
n-gram path instead.

**`ingest` and `score` are not optional**, and the reason is the thing C6
protects: the seed loads accounts and raw requests *only*, so the database never
contains the groupings it is measured on. Problems exist because the pipeline
formed them. Skip `ingest` and Beat 1 opens on an empty list; skip `score` and
every problem on the board reads `unscored`.

---

## The company

**Ledgerline** — billing and revenue operations for finance teams that close the
books monthly. Customers are controllers, AR leads and RevOps managers.
Strategy lives in `config/strategy.json`: four FY27 goals, of which
**enterprise readiness** and **close the month in one day** carry the most
weight.

55 requests arrived over ten weeks through five channels — CSM notes, AE deal
notes, support tickets, internal advocacy, and customers writing in directly.
They are deliberately uneven: some are solution-shaped ("add a CSV export
button"), some are vague ("copy and paste between tabs all day"), some are
frustrated ("our auditors rejected the evidence pack").

---

## Beat 1 — The corpus is not 55 asks, it's a set of shared problems

Open the problem list. **23 problems**, each backed by the verbatim requests
that formed it. Nobody labelled these: the pipeline read 55 pieces of raw text
and grouped them.

Say the honest number out loud: the ground truth is **12**, so the pipeline
still over-splits. Measured recall is 0.466 ([eval-results](./eval-results.md)),
and the gap is visible in Beat 2.

Point at **"cannot automatically transfer billing data from the
revenue-operations platform to their accounting general ledger"** and expand its
evidence. Five requests from four accounts in four different vocabularies — a
CSM note, a customer writing in, a support ticket, an internal note. A keyword
search for "CSV" finds one of them.

---

## Beat 2 — Popularity and value point in opposite directions

This is the contrast the product exists to surface. Two problems, side by side,
**as the pipeline actually formed them**:

| | Notification scoping *(largest of 4 fragments)* | EU data residency |
|---|---|---|
| Requests | 4 | 3 |
| Distinct accounts | 4 | 3 |
| Combined ARR | $79,000 | **$1,570,000** |
| Segments | all SMB | all enterprise |
| Strategy goals hit | none | enterprise readiness |
| Renewal risk in the text | none | two renewals, one explicit "€410k at risk" |

**20× the ARR on fewer voices, and the only one of the two that moves a company
goal.** That is the trade the ranking has to get right.

### Say this part out loud, because a reviewer will find it

Nine customers raised notification scoping. The pipeline currently splits them
across **four** problems (4 + 2 + 2 + 1 accounts) instead of one — so it
*understates* that problem's reach. That is signal fragmentation: precisely the
failure this product exists to fix, visible in its own output.

It is a measured recall gap, not a mystery: 8 of 11 planted duplicate pairs are
caught, and the three misses include this cluster. It is also the honest reason
the demo is stronger on *precision* than on *recall* — zero false merges
anywhere a human would not have been asked, but duplicates still slipping
through as separate problems.

Data residency is three voices. One is Legal blocking a contract expansion,
one is procurement gating a renewal, one is a CISO in a security review.

**The ranking should put data residency above notification scoping, and show
you why.** The priority board shows the factor decomposition: `customer_value`
citing the enterprise accounts, `strategic_fit` citing the enterprise-readiness
goal, `evidence_strength` honestly *lower*. The score doesn't hide the tension —
it shows a PM the trade and makes them own it.

**Measured on this corpus, all 23 problems scored.** Data residency is **#1 on
the board**; notification scoping's largest fragment is **#19 of 23**:

| | Data residency | Notification scoping *(largest fragment)* |
|---|---|---|
| Distinct accounts | **3** | **4** |
| Band | **now** | **no** |
| Raw score | 0.890 | 0.305 |
| `customer_value` | 1.00 — "direct blocker for high-ARR enterprise accounts, threatens multiple renewals" | 0.20 — "friction and UX pain for SMB accounts, not a direct threat to renewal" |
| `strategic_fit` | 1.00 — "listed explicitly under the Enterprise readiness goal" | 0.10 — "does not align with any of the stated FY27 strategic goals" |
| `evidence_strength` | 0.90 | 0.60 |
| `effort` | 0.10 — architectural, high cost | 0.80 — contained frontend work |
| Confidence | 0.90 | 0.70 |

**Fewer accounts, higher band.** That is the whole claim, and the decomposition
shows exactly where it comes from: `strategic_fit` 1.00 against 0.10. Under
weights `w2` the `now` band holds the top **4** of 23 — the cut points sit in the
two widest gaps in the measured score distribution, because a `now` band ten
problems wide is a list, not a prioritisation. The model
volunteered the tension on the losing side without being asked for it —
*"this is a widely-felt usability problem that does not contribute to the
company's core strategic goals"* — which is the sentence a PM should have to
argue with.

Note the one place to be honest under questioning: `evidence_strength` is
**0.90 for three accounts and 0.60 for four**, which is backwards for a factor
defined as a raw distinct-account count. The model imported segment and ARR
into it, double-counting what `customer_value` already carries. It does not
change the outcome — recomputing with a count-faithful evidence strength leaves
both bands where they are, because the 0.70 of weight on value and fit
dominates — but it is a prompt defect, recorded in
[TASKS C5](./TASKS.md#c5--explainable-priority--25-min). The board showing the
raw account count beside the band is what makes it visible at all.

---

## Beat 3 — Type the request yourself

This is the centerpiece. Open intake and type:

> **Closing the books means a week of retyping**
>
> Every period my controller transcribes each total into Sage by hand. It eats
> most of a week and she has caught several slips after the fact.

Watch the stages resolve: extract → embed → retrieve → adjudicate.

It **auto-attaches** — no human confirmation needed — to *"cannot
automatically transfer billing data from the revenue-operations platform to
their accounting general ledger"*, at verdict `same`, confidence **0.99**,
cosine **0.822** against a `T_auto` of 0.8. One `same` out of 23 candidates
compared; the adjudicator's reason appears in the UI:

> "Both describe the exact same underlying problem of lacking automated data
> transfer from the platform into an accounting general ledger system."

Measured, not hoped for — see [eval-results](./eval-results.md).

**It shares zero content words with any of them.** Not "few" — zero. No
`invoice`, no `export`, no `sync`, no `integration`, no `ledger`, no `API`.
That claim is machine-checked, not asserted: `src/seed/seed.test.ts` runs a
stemming tokenizer over the demo text against all seven and fails the build on
any overlap. Every lexical approach — keyword, trigram, tag taxonomy, full-text
search — returns nothing here.

Then show the explanation: the matched problem statement, its existing
evidence, and the adjudicator's reason. And show the escape hatch — *"actually,
mine is different"* — which records the disagreement rather than burying it
([ADR 0005](./adr/0005-duplicate-resolution-actor.md)).

---

## Beat 4 — It knows what it got wrong

```bash
npm run eval
```

Precision and recall against the labelled corpus, per threshold, with the
chosen auto-merge threshold justified from the curve rather than picked by
feel. Two things to say out loud:

- **Eleven planted disjoint pairs** are the recall test. Each is two requests
  about one problem with no shared vocabulary. **Eight of eleven are caught**,
  including the hardest (`r06a/r06b`), whose cosine of 0.741 sits *below* the
  best non-duplicate in the corpus — unreachable by similarity alone.
- **Three related-but-distinct pairs** are the precision test — adjacent
  problems that a greedy merger would collapse. **All three stay distinct**, and
  auto-band precision is **1.000**: zero false merges anywhere a human would not
  have been asked. "Approval controls don't exist"
  vs. "approvers can't act from email" are both about approvals and are not the
  same problem. A false merge there would hide real demand invisibly, which is
  why the thresholds are tuned for precision and the uncertain band goes to a
  human.

---

## What to say about the limits

Say these before a reviewer finds them:

- **The labels are mine.** I wrote the corpus and the ground truth, so the eval
  measures the pipeline against my notion of a duplicate on 55 items. It is not
  external validation, and the threshold is fitted on the data it's scored
  against.
- **Novel free-typed input degrades.** Fixtures cover the corpus and the demo
  request. Anything else falls back to n-gram similarity, which *will* miss
  paraphrases — the capability's own headline case. The UI labels that path
  rather than hiding it.
- **The prospect has no ARR.** Meridian Freight files through an AE and has no
  contract, so pipeline value doesn't reach `customer_value` at all. A real
  system would weight deal size; this one doesn't.
- **No support rows are seeded.** "Nine accounts" above means nine accounts
  that independently wrote in — evidence breadth, not clicks on a button. The
  one-click support action is live in the UI for a reviewer to use.
- **The factor estimates come from the fast model, and nothing measures them.**
  Scoring was moved off the strong tier because intermittent 503s burned its
  daily cap ([ADR 0001](./adr/0001-llm-provider.md), third amendment). The eval
  harness measures dedupe, not scores, so there is no before/after comparison
  and no quality number to quote here. The structural answer is the one the
  design already rested on: the factors are estimates, the weights are
  PM-owned, and every band is overridable with a recorded reason.
- **One factor contradicts its own definition.** `evidence_strength` is
  supposed to be a raw distinct-account count, with ARR and segment reaching
  the score only through `customer_value`. The model weights segment into it
  anyway. It does not change any band on this corpus, and it is visible because
  the board prints the real account count next to the estimate — but it is a
  defect, not a subtlety.
- **No PM reviewed the seeded problem set.** The ingest pass ran with nobody
  present, so an attach on a lower-confidence `same` verdict stands in for a
  PM having confirmed it. A real PM could have rejected some of those, and the
  problem set would then look different. Those attaches are marked
  `needs_review`, so the flagged population is visible rather than hidden —
  and the precision number quoted in Beat 4 covers only the **auto** band,
  where no human would have been asked.

  **`/review` is where that gets worked** ([E1](./TASKS.md#e1--ui-polish-of-the-demo-screens)):
  the eleven flagged attaches, each with the verbatim request, the problem it
  landed in, and the verdict, confidence and cosine behind the match. Confirm
  or reject. Worth doing live for one item — rejecting un-merges without
  deleting, and both decisions are recorded, which is the only way an override
  rate can distinguish "the PM agreed" from "nobody looked".
