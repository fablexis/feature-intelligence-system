# Loom script — 5 minutes

A script to read, not a summary to improvise from. Every number below is in the
committed demo state, so the screen and the words agree.

**Before you hit record**

```bash
npm run demo:reset      # → "canonical — safe to film." Run it between takes too.
npm run dev             # http://localhost:3000
```

`demo:reset` clears the tables in place and replays the setup, so it is safe to
run while `npm run dev` is up — no restart. It prints the exact counts this
script quotes and **fails loudly** rather than letting you film against a
database that drifted. Browser at ~110% zoom, one tab, nothing else open.

Timings are a budget, not a metronome. If you overrun anywhere, cut from 2:45–3:45
(architecture) — never from 1:00–2:45, which is the only part a viewer cannot get
from the README.

---

## 0:00–0:30 · The problem, and whose problem it is

> Product teams can see **how many people asked for something**. They cannot see
> **what problem those people share**.
>
> Requests arrive solution-shaped — "add a CSV export button" — in each
> requester's own words, through five channels that don't talk to each other. So
> one need enters as *N* unrelated records, and the only quantified field on any
> of them is a vote count.
>
> That means a problem raised forty times in forty wordings presents as forty
> small asks, and loses to one raised twelve times consistently. Teams
> systematically underweight their most widely-felt problems.
>
> Three people feel this. The **PM**, who triages and owns the call. The **CSM or
> AE**, who files for a customer minutes after a call and has about sixty seconds
> of attention before they give up and paste it into Slack. And the **product
> leader**, who has to understand a ranking in one screen, usually projected.

*(Screen: nothing yet, or the home page. Don't click.)*

---

## 0:30–1:00 · The thesis

> So the reframe this is built on:
>
> **A feature request is not a unit of demand. It's a piece of evidence about
> demand.**
>
> Votes on solutions aggregate the wrong object, and every step downstream
> inherits that error. So this system de-duplicates on the **extracted
> underlying problem** rather than the wording — and it does it at intake, before
> the record exists, because that's the one moment deduplication is free.
>
> And this is where AI is load-bearing rather than decorative. "Add CSV export"
> and "finance can't get the numbers into Excel" are the same problem and share
> **zero** content words. Keyword search, trigrams, tag taxonomies — they all
> return nothing on exactly the half that matters. But every arithmetic step
> downstream is still deterministic code.

---

## 1:00–2:45 · Live demo

### Home — the shape of the thing (1:00–1:20)

**Click:** `http://localhost:3000`

> 55 customer requests came in over ten weeks. The system read them and worked
> out 23 problems. Nobody sorted these by hand.

**Point at** the note at the bottom of the page.

> And the front door says what it gets wrong before I do: the right answer here
> is 12 problems, not 23, so it splits some problems that belong together —
> it catches a bit under half the duplicates it should. What it doesn't do is the
> expensive mistake. Of the matches it made on its own, **none were wrong.**

### Intake — the centerpiece (1:20–1:55)

**Click:** `New request` in the nav → **click** `Use the demo request`

The two fields fill with:

> **Closing the books means a week of retyping**
> Every period my controller transcribes each total into Sage by hand. It eats
> most of a week and she has caught several slips after the fact.

**Click:** `Submit`. Let the five steps land on screen — don't talk over them.

> Read what that text does *not* contain. No "invoice". No "export", no "sync",
> no "integration", no "ledger", no "API". It shares **zero** content words with
> the five requests already on the problem it's about to find — or with any of
> the seven the corpus has about that problem. And that is machine-checked, not
> asserted: there's a test that runs a stemming tokenizer over this exact text
> against all seven and fails the build on any overlap.

**Point at** the green outcome panel: *"This is a problem we already track"*.

> It filed itself against *"cannot automatically transfer billing data from the
> revenue-operations platform to their accounting general ledger"*. Confidence
> **0.99**, match score **0.822** against a bar of 0.80 — so it went in without
> asking anyone. Twenty-three problems compared.
>
> And it says why: *"Both describe the exact same underlying problem of lacking
> automated data transfer from the platform into an accounting general ledger
> system."*

**Point at** `Actually, mine is different`.

> That button is the part I'd defend hardest. A wrong merge is the expensive
> error precisely because it's **invisible** — the demand disappears into
> something else and nobody ever notices. The submitter is the one person who can
> tell. One click files theirs separately and puts the disagreement on record.

### Review queue — where a person stays in the loop (1:55–2:20)

**Click:** `Review` in the nav (the amber **11** in the nav is the count).

> Eleven matches weren't confident enough to make unattended, so they came here
> instead. This is the other half of that trade: precision is bought with recall,
> and the uncertain band goes to a human.

**Point at** the first card, top to bottom.

> The customer's own words first, because that's what I'm actually judging —
> Cobbler & Sons, SMB, $21k: *"Can I turn off payment alerts only?"* Then the
> problem it was filed under. Then what the AI concluded: **the same problem**,
> confidence 0.90, text similarity 0.768.

**Click:** `Confirm — same problem` on that first card.

> Confirmed. And notice my *agreement* was recorded, not just a disagreement
> would be. If nothing were written down when I say yes, there'd be no way to
> tell a reviewed queue from an ignored one — and an override rate near zero
> would look like success when it actually means the humans stopped thinking.

**Click:** `Reject — not the same problem` on the next card (Orchard Labs, *"API
for pulling invoice detail?"*).

> Rejecting removes it from that problem. It does **not** delete anything — the
> customer's words are intact on the problem page, one click from going back.

### Priority — popularity versus value (2:20–2:45)

**Click:** `Priority` in the nav.

> Four problems in `now`, eight in `next`. And here's the contrast the whole
> product exists to surface.

**Point at** the top row, then the `no` band further down.

> Top of the board: data residency. **Three** accounts, **$1.57M**, band `now`.
> Down here in `no`: notification scoping. **Four** accounts — more voices —
> **$79k**. Fewer accounts, higher band. That's the trade a vote count gets
> backwards every time.

**Click:** `Why this band` on the data residency row.

> And it has to show its work. Customer value **1.00** — *"a direct blocker for
> high-ARR enterprise accounts, threatens multiple renewals."* Strategic fit
> **1.00** — *"listed explicitly under the Enterprise readiness goal."* Effort
> **0.10**, because it's architectural. Each factor cites the actual requests it
> came from.
>
> Notification scoping scores strategic fit **0.10** — and the model volunteered
> the argument against its own answer: *"this is a widely-felt usability problem
> that does not contribute to the company's core strategic goals."* That's the
> sentence a PM should have to argue with.
>
> The weights are a judgement about this company, so they're **not** the model's
> to make. They're in a file I own and my team can diff. And every band can be
> overridden — with a mandatory reason.

---

## 2:45–3:45 · Architecture and the tradeoffs

> Next.js App Router, TypeScript, SQLite with Drizzle, Gemini through the Vercel
> AI SDK behind a provider interface. Four things are worth your time.
>
> **One — the pipeline is two-stage, and that's a measured decision.** Embedding
> retrieval for cheap recall, then one LLM pass to adjudicate. I'd assumed
> similarity alone might carry it; it can't, and I can show you why. On this
> corpus the *worst* true duplicate scores **0.741** while the *best*
> adjacent-but-distinct pair scores **0.772**. The classes overlap by 0.031, so
> no cosine threshold separates them — a number that can't tell duplicates from
> neighbours must not be the thing that decides identity. So formation follows
> the adjudicator's verdict, and the threshold only governs how much human
> oversight an attach needs.
>
> **Two — record and replay.** Everything you just saw ran with no API key and no
> network. Real Gemini outputs were recorded once into committed fixtures, keyed
> by a hash of the input. My first design for the keyless path was a deterministic
> n-gram mock, and I threw it out: n-grams cannot match "CSV export" to "finance
> can't get the numbers into Excel", so a reviewer without a key would have seen
> the exact opposite of the central claim. Novel free-typed text still falls back
> to that path, and when it does, the UI says so in amber rather than dressing a
> degraded result as the real one.
>
> **Three — Gemini, chosen on budget, and the free tier had opinions.** Twenty
> `generate_content` requests per day per model. Worse: a 503 "model overloaded"
> **consumes** one of those twenty, so a nested retry on an overloaded model
> burns the day's quota without producing anything. That's why scoring runs on
> the fast tier and why the recording scripts have a dry-run mode that reports
> the budget before spending it. All of it is written down in ADR 0001 with three
> amendments, in the order I learned it.
>
> **Four — humans stay in the loop at six named points**, and every one of them
> writes to an append-only table. Suggested and final values are both kept
> forever. That's deliberate: the recorded *reasons* are the highest-value thing
> this system produces.

---

## 3:45–4:20 · What the eval says, including the gaps

**Terminal:** `npm run eval`

> This is the part I'd want to be judged on. The corpus has hand-authored ground
> truth — which requests describe the same problem — and the harness runs the
> real pipeline against it over a grid of thresholds, offline, with no network.
>
> **Precision 1.000, recall 0.466.** Eight of eleven planted disjoint-vocabulary
> pairs caught, including the hardest one, whose similarity sits *below* the best
> non-duplicate in the corpus — unreachable by similarity alone. And zero of
> three adjacent pairs wrongly merged: *"approval controls don't exist"* and
> *"approvers can't act from email"* are both about approvals and are not the
> same problem.
>
> The eval is also what made the product better rather than just measuring it.
> Version one of the adjudication prompt asked the model to rate similarity.
> Version two asks it a question — *is this the same underlying problem?* —
> and pins the output schema. Recall went 0.319 to 0.466, precision 0.974 to
> 1.000, problems formed 31 down to 23 against a truth of 12.
>
> Now the gaps, because you'd find them anyway. **Recall 0.466 missed its
> pre-registered target of 0.60** — I wrote that target down before the run so I
> couldn't fit it afterwards, and it's reported as a miss. **I wrote both the
> corpus and the labels**, so this measures the pipeline against my notion of a
> duplicate on 55 items; it is not external validation. **One factor contradicts
> its own definition** — evidence strength is supposed to be a raw account count,
> and the model folds segment into it anyway; it changes no band here, but it's a
> defect, and it's visible precisely because the board prints the real account
> count next to it. And **nothing measures the factor estimates at all** — the
> harness scores deduplication, not scoring. Which is exactly why the weights are
> mine and every band is overridable.

---

## 4:20–5:00 · How I used AI to build it

> Last thing, and it's the part that's actually about working with these tools.
>
> I ran this **spec-driven**: product spec, then architecture and five ADRs, then
> a task list with budgets, then code. No code without a task ID. Every task:
> explore, plan, implement, verify each acceptance criterion individually,
> commit. Conventional commits carrying the task ID.
>
> **Every prompt I sent is in `prompts.txt`, verbatim**, with what was done in
> response. So the chain runs prompt → task ID → commit, and you can audit any
> decision backwards. That file is also the source of truth for time, which is
> why I can tell you the implementation ran **~286 minutes against a 180-minute
> appetite** instead of claiming it came in on budget.
>
> **Where I pushed back on the AI matters more than where I accepted it.** Four
> examples. I challenged my own thesis in writing before building — the spec has
> a section arguing *against* it, which is where the "don't remove the vote,
> re-point it" decision and the precision-over-recall asymmetry came from. I
> threw out the n-gram keyless path because it would have demoed the opposite of
> the claim. When the threshold-selection rule I'd pre-registered degenerated —
> zero false merges at every operating point, so the constraint separated
> nothing — I didn't quietly pick a number; the config file records that the rule
> failed and what I used instead. And the review queue you just saw exists
> because an ADR promised a human a filtered queue and the core build shipped
> only the count.
>
> The build log is honest about what the AI got wrong, too. The most expensive
> bug in the project was a fresh-clone failure: model IDs came from the
> environment only, so with nothing configured every fixture lookup missed and
> the whole pipeline fell back to n-grams — not a degraded demo, the exact
> opposite of the central claim. It survived because a verification script was
> printing the models it *wasn't* using. Caught by actually cloning the repo into
> a temp directory and following my own README.
>
> That's the system. Thanks for watching.
