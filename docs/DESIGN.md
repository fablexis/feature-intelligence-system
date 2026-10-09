# Design direction — "claro y vivo"

**Scope:** the six demo-path screens ([DEMO.md](./DEMO.md)). Product context is
[PRODUCT.md](./PRODUCT.md) — this file does not restate it. Mode: a working tool
for a PM.

**Reference:** the approved Design System artifact, version `1791429185-4f66`,
exported in full to [`docs/design/reference/`](./design/reference) — tokens,
brand book, per-view notes and thirteen live HTML mockups. The mockups are the
visual source of truth; they are rebuilt as React components, never copied in.
Their sample content (Northwind Traders and friends) is invented and is never
hardcoded: every screen renders the data the app already loads.

This replaces the direction written at E1. What it supersedes, and why, is
recorded at the end rather than quietly dropped.

## The idea

A tool for deciding what to build should feel **light, fast and sure of
itself**. Near-white cool background, one saturated ultramarine doing all the
pointing, soft cards with a blue-tinted shadow, and a lot of air. Motion
explains: what arrives, enters; what is computed, fills; what can be pressed,
answers.

Two constraints from PRODUCT's usage scene still decide the hard calls:

- **The PM is in a 30–45 minute triage block, resumable mid-way.** Density and
  scanability beat decoration.
- **The board gets projected in prioritization meetings.** A projector loses
  contrast and fine weight differences, so band and account count stay at
  display size.

## Color

One accent. Ultramarine does three jobs and no others: primary action, active
navigation, emphasis on figures. Everything else is neutral.

- **The band ladder** is that same blue in four intensities — `now` solid,
  `next` tinted, `later` outlined, `no` neutral — so the ordering reads before
  the label does. The label still carries the word; colour is never the only
  carrier of meaning.
- **Amber (`flag`) is reserved** for "a person must decide" and "something is
  degraded". Nothing decorative may use it. This rule survives from E1 and is
  the one most easily broken by accident.
- Rose for destructive, mint for success. Both soft, both always with a word.

Day and Night, both AA-verified, following `prefers-color-scheme`. **No toggle**
— the OS already holds that preference.

## Type

Three families, each with one job:

- **Plus Jakarta Sans** (500–800) — headings and figures.
- **DM Sans** — interface text and paragraphs, 16px body on a 25px line.
- **JetBrains Mono** — measurements only: confidence, similarity, ARR, weighted
  sums. Never as a costume for "technical".

Everything is larger than at E1: body 16, button text 16 in a 48px control (56
for the primary action), figures up to 64. Prose caps at ~70 characters.

They must be wired to the variables `next/font` actually defines. E1 shipped the
entire app in the browser's default serif because `--font-sans` referenced
itself, so the theme block points at the font variables and never at itself —
and the result is verified in the built CSS, not by eye.

## Form

Cards at radius 20 (28 on hero), a blue-tinted shadow that deepens on hover,
near-invisible borders. Buttons at radius 12, fields at 54px, chips and bands as
pills. Spacing on a 4px scale: 24px inside a card, 32px between them.

## Motion

Moderate and purposeful. Seven moves, no more:

1. **Stagger** — rows enter one at a time, 45ms apart, capped at 12.
2. **Count-up** — a figure rises to its value in 900ms.
3. **Bars fill** from the left.
4. **Lift** — 3px on anything pressable.
5. **Expand** — height via `grid-template-rows: 0fr → 1fr`, no JS measuring.
6. **Sliding indicator** on filters and segmented controls.
7. **Spring** — confirmations and toasts only, once per screen.

Durations 140 / 240 / 560 / 900ms. `ease-out` for entrances and fills,
`ease-spring` for the two places that are allowed to bounce.

**Under `prefers-reduced-motion` everything stops and the final state shows
immediately.** Not "reduced" — stopped.

The Impeccable detector flags `ease-spring` as bounce easing, and it is kept
anyway: it is the reference's own token, and the brief scopes it to
confirmations and toasts — two moments per screen, once each. A warning that
the approved direction overrides is recorded here rather than silenced.

**One exception, deliberately: the priority board never counts up.** It is read
off a projector while someone is talking. Band, account count and ARR render
final on load. Count-up belongs to Overview, where nobody is mid-sentence.

## Copy

Written for a PM, not for the people who built it. No task IDs, no demo beat
numbers, no ADR paths, no threshold symbols like `T_auto`, no shell commands —
each of those asks the reader to hold a second model of the system just to read
a screen. The depth lives in the README, `docs/` and the code comments.

- **Name the outcome, not the column.** The database stores `needs_review`; the
  screen says "confirmed as the same problem".
- **Keep the honest numbers, lose the jargon.** "recall 0.466" became "it
  catches a bit under half the duplicates it should". Plain language is not
  softer language.

Every page opens the same way: eyebrow, title, one-line lede.

The one exception is `app/error.tsx`, a crash screen read by whoever is running
the project locally, where the exact `npm run` recovery is the kindest thing on
the page.

## Deliberate departure from the reference

**Priority stays stacked.** `Vistas.md` makes it four band *tab cards* that swap
the panel, showing one band at a time. The Loom's key beat is data residency in
`now` at the top against notification scoping in `no` below it — fewer accounts,
higher band — visible in one view and usually projected. Tabs destroy exactly
that comparison. The four band cards are kept as a summary header carrying band
name and count, built as **anchor links that scroll to their band**. The
design's shape survives, and so does the contrast.

## What this supersedes from E1

| E1 decision | Now | Why |
|---|---|---|
| One type family (Geist), tight 1.2 scale | Three families with distinct jobs, larger scale | The reference separates heading, text and measurement, and the larger scale is what makes a projected board legible |
| Motion: 150ms transitions only, no entrance choreography | Seven moves, 140–900ms, staggered entrances | "Motion explains" is the approved direction. The reduced-motion rule is stricter than E1's, not looser |
| Dark tokens defined with no path to them | `prefers-color-scheme`, both themes real and measured | Tokens nobody can reach are decoration |
| Ordinal band ladder; amber reserved; band and account count at display size | **Unchanged** | These were right, and the reference arrives at the same three independently |
| PM copy with no internal jargon | **Unchanged** | |
| Empty states name what is missing in product language | **Unchanged**, plus skeletons that hold the content's shape so nothing jumps | |
