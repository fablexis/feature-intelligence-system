# Loom script — 5 minutes

The `>` lines are spoken. Everything else is a stage direction. Written to be
said out loud, so the sentences are short and nothing depends on being read.

**Before you hit record**

```bash
npm run demo:reset      # → "canonical — safe to film." Run it between takes too.
npm run dev             # http://localhost:3000
```

`demo:reset` clears the tables in place, so it is safe with `npm run dev`
already up. It asserts the counts this script quotes and fails loudly rather
than letting you film against drifted data. Browser at ~110% zoom, one tab.

Budget: **686 spoken words, 4:34 at 150 wpm.** The pipeline pause at intake is
silent, so the take lands near 4:45. If you overrun, cut from architecture.
Never from the live demo — that is the part a reviewer cannot get from the
README.

---

## 0:00–0:20 · The problem, and whose problem it is

> Teams can see how many people asked for something. Not what problem those
> people share.
>
> Requests arrive solution-shaped, in everyone's own words, through channels
> that don't talk. So one problem in forty wordings looks like forty small asks.
>
> The PM owns that call. The CSM filing has a minute.

---

## 0:20–0:40 · The thesis

> A feature request is not a unit of demand. It is evidence about demand.
>
> So this groups by the problem underneath, not the words, at intake.
>
> "Add CSV export" and "finance can't get the numbers into Excel" share zero
> words. No keyword search finds that pair.

---

## 0:40–2:40 · Live demo

### Home (0:40–0:55)

**Click:** `http://localhost:3000`

> Fifty-five customer requests, ten weeks. The system found twenty-three
> problems. Nobody sorted these by hand.
>
> It also says what it got wrong. The right answer is twelve, so it over-splits.
> But of the matches it made alone, none were wrong.

### Intake (0:55–1:35)

**Click:** `New request` → `Use the demo request` → `Submit`. Let the five steps
land. Don't talk over them.

> Read what that text does not contain. No invoice. No export. No sync. No
> ledger. No API. It shares zero content words with the five requests already on
> the problem it finds. A test enforces that.

**Point at** the outcome panel.

> It filed itself against the general ledger problem. Confidence 0.99. Match
> score 0.822, against a bar of 0.80. So it went in without asking anyone, and
> it shows why.

**Point at** `Actually, mine is different`.

> This button matters most. A wrong merge is expensive because it is invisible —
> demand disappears and nobody notices. The submitter is the only one who can
> tell, and saying so takes one click.

### Review queue (1:35–2:00)

**Click:** `Review` in the nav.

> Eleven matches weren't confident enough to make alone, so they came here.
> Precision is bought with recall.
>
> The customer's own words first, because that is what I'm judging. Then the
> problem. Then what the AI concluded.

**Click:** `Confirm — same problem` on the first card.

> My agreement is recorded, not just a disagreement. Otherwise an override rate
> near zero looks like success when it means nobody read anything.

**Click:** `Reject — not the same problem` on the next card.

> Rejecting takes it off that problem. Nothing is deleted.

### Priority (2:00–2:40)

**Click:** `Priority` in the nav.

**Point at** the top row, then the `no` band below.

> Here is the contrast the product exists for. Top of the board: data residency.
> Three accounts, $1.57M, band `now`. Further down, in `no`: notification
> scoping. Four accounts — more voices — $79k.
>
> Fewer accounts, higher band. That is the trade a vote count gets backwards.

**Click:** `Why this band` on the data residency row.

> And it shows its work. Customer value 1.00. Strategic fit 1.00, against 0.10
> for notification scoping. Each factor cites the requests behind it.
>
> The losing side even states the argument against itself: widely felt, but it
> moves no company goal.
>
> The weights are mine, not the model's. Every band is overridable, with a
> reason.

---

## 2:40–3:30 · Architecture and the tradeoffs

> The pipeline is two-stage: retrieval by meaning, then one model pass to judge.
> That split is measured, not assumed. The worst true duplicate scores 0.741.
> The best adjacent-but-distinct pair scores 0.772. They overlap, so no
> threshold separates them.
>
> Everything you just saw ran with no API key: real model outputs, recorded once
> and replayed. Text outside the corpus falls back to letter matching, and the UI
> says so.
>
> Gemini, because there was no budget. The free tier allows twenty calls a day
> per model, and an overloaded 503 still consumes one. So a retry burns quota
> and returns nothing.

---

## 3:30–4:10 · What the eval says, including the gaps

**Terminal:** `npm run eval`

> The corpus has hand-authored ground truth, and the harness runs offline.
> Precision 1.000. Recall 0.466, against a target of 0.60 I wrote down before the
> run.
>
> The eval also improved the product. Version one asked the model to rate
> similarity. Version two asks: is this the same underlying problem? Recall went
> 0.319 to 0.466, precision 0.974 to 1.000.
>
> Three gaps, before you find them. Recall missed its target. I wrote the corpus
> and the labels, so this is not external validation. And evidence strength
> folds in segment when it should be a plain count.

---

## 4:10–4:50 · How I used AI to build it

> I ran this spec-driven: spec, architecture and ADRs, tasks, then code. No code
> without a task ID.
>
> Every prompt is in `prompts.txt`, verbatim: prompt to task ID to commit. It is
> why I can say the implementation took 286 minutes against a 180-minute
> appetite.
>
> Where I pushed back matters more than where I agreed. My first keyless design
> was a word-overlap mock. I threw it out: it would have demoed the opposite of
> the claim. And when my pre-registered threshold rule separated nothing, the
> config records that it failed.
>
> That's the system. Thanks for watching.
