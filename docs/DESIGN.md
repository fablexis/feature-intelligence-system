# Design direction — E1

**Scope:** the four demo-path screens plus the PM review queue
([DEMO.md](./DEMO.md)). Product context is [PRODUCT.md](./PRODUCT.md) — this
file does not restate it. Mode: **Operate**. Written at E1, outside the
appetite, as the direction the screens were cut against.

## The scene decides everything

PRODUCT's usage scene gives two hard constraints the look has to answer, and
they pull in opposite directions:

- **The PM is in a 30–45 minute triage block, resumable mid-way.** Density and
  scanability beat decoration: the answer to "what needs me?" must be legible
  without reading prose.
- **The board is frequently projected in prioritization meetings.** A projector
  loses contrast and fine weight differences. So the two numbers Beat 2 turns on
  — **band** and **account count** — are set at display size with real color
  separation, while everything supporting them stays small.

A tool you visit, not one you live in: no dashboard furniture, no onboarding,
no decoration that has to be scrolled past on the second visit.

## Type

One family (Geist Sans), fixed rem scale, ~1.2 ratio. Geist Mono carries
**measurements only** — cosine, confidence, weighted sums, thresholds — because
those are read as digits against each other, not as words. `tabular-nums` on
every number that appears in a column so the digits line up down the page.
Prose capped at ~70ch; metric strips and evidence rows run denser.

## Color

Restrained, with exactly three color roles. Everything else is neutral.

1. **The band ladder** — one hue (blue 250–255) stepped by intensity:
   `now` solid, `next` tinted, `later` outlined, `no` neutral. An ordinal scale
   gets a sequential ramp, so the ordering is visible before the labels are
   read, and nothing in the ranking shares a hue with an alarm.
2. **Honest flags** — amber (`--flag`), and only for the two things the product
   promised to never hide: `needs review` and the **degraded path**. Reserved:
   if amber appeared anywhere decorative, the degraded label would stop meaning
   anything.
3. **Destructive** — the existing red, on reject/un-merge only.

`--muted-foreground` moves from `oklch(0.556)` (4.74:1 — passing, but thin
under a projector) to `oklch(0.5)` (6:1). Browser surfaces are themed from the
palette: selection, caret, focus ring, scrollbar.

## Components

- **Band chip** is the only element allowed display size. It carries the band
  and, beside it, the raw distinct-account count — the comparison Beat 2 exists
  for. Those two never separate.
- **Provenance block** is one shape used everywhere a model spoke: verdict ·
  confidence · cosine · rationale, and beneath it what a human changed. Same
  shape on the queue, the detail page and the board, so "what did the AI say
  here" is answered by recognition rather than by reading.
- **Flat rows over cards.** The board was 23 stacked cards each with an open
  form; it is now band-grouped rows with the decomposition behind a
  `<details>`. Nested cards are gone.
- **States:** empty states name the command that fills them (`npm run ingest`),
  loading states are skeletons matching the row geometry they replace, errors
  name the failure and the recovery. Every screen on the demo path has all
  three, because a reviewer following README on a fresh clone hits the empty
  ones first.

## Motion

150 ms on hover/border/background only. No entrance choreography: the PM is
mid-task and the board is often already on a projector when it loads.

## Out of scope for E1

Dark mode ships as tokens but has no toggle (the scene is a lit meeting room, so
light is the default and the only path exercised). No charts — the board's job
is comparison between two rows, not a trend. No in-app weight editing
([D6](./PRODUCT.md#recorded-decisions)).
