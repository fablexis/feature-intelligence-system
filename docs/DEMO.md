# Demo Path

The five minutes a reviewer should watch. Every number below comes from the
seeded corpus — nothing here is staged at demo time except the one request you
type yourself.

**Setup**

```bash
npm install
npm run db:migrate
npm run seed        # 22 accounts, 55 requests, 0 problems
npm run dev
```

No API key needed. The fixture provider replays real Gemini outputs recorded
over this corpus ([ADR 0004](./adr/0004-record-replay-provider.md)).

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

## Beat 1 — The corpus is not 55 asks, it's 12 problems

Open the problem list. Twelve problems, each backed by the verbatim requests
that formed it. Nobody labelled these: the pipeline read 55 pieces of raw text
and grouped them.

Point at **"Finance must re-enter Ledgerline figures into the system of record
by hand"** and expand its evidence. Seven requests, in seven different
vocabularies, from a CSM note to a prospect's blocking requirement. A keyword
search for "CSV" finds one of them.

---

## Beat 2 — Popularity and value point in opposite directions

This is the contrast the product exists to surface. Two problems, side by side:

| | Notification scoping | EU data residency |
|---|---|---|
| Requests | **9** | 3 |
| Distinct accounts | **9** — the widest in the corpus | 3 |
| Combined ARR | $150,000 | **$1,570,000** |
| Segments | all SMB | all enterprise |
| Strategy goals hit | none | enterprise readiness |
| Renewal risk in the text | none | two renewals, one explicit "€410k at risk" |

On a vote count, notification scoping wins nine to three and goes on the
roadmap. It is a real problem — nine customers independently complained, two
muted alerts entirely — but it is nine small accounts asking for a filter.

Data residency is three voices. One is Legal blocking a contract expansion,
one is procurement gating a renewal, one is a CISO in a security review. Ten
times the ARR and the only one of the two that moves a company goal.

**The ranking should put data residency above notification scoping, and show
you why.** Expand the factor decomposition: `customer_value` cites the three
enterprise accounts, `strategic_fit` cites the enterprise-readiness goal,
`evidence_strength` is honestly *lower*. The score doesn't hide the tension —
it shows a PM the trade and makes them own it.

---

## Beat 3 — Type the request yourself

This is the centerpiece. Open intake and type:

> **Closing the books means a week of retyping**
>
> Every period my controller transcribes each total into Sage by hand. It eats
> most of a week and she has caught several slips after the fact.

Watch the stages resolve: extract → embed → retrieve → adjudicate.

It lands on **"Finance must re-enter Ledgerline figures into the system of
record by hand"** — the problem whose seven requests include "CSV export of
invoice lines" and "No integration with our general ledger".

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
  about one problem with no shared vocabulary.
- **Three related-but-distinct pairs** are the precision test — adjacent
  problems that a greedy merger would collapse. "Approval controls don't exist"
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
