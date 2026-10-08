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

One family (Geist Sans), fixed rem scale, ~1.2 ratio. It has to be wired to the
variable `next/font` actually defines: a self-referential `--font-sans` in the
theme block silently invalidated the declaration and shipped the whole app in the
browser's default serif, which no amount of scale discipline survives. Geist Mono carries
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
- **Provenance block** is one shape used everywhere a model spoke: what it
  concluded · confidence · text similarity · why, and beneath it what a person
  changed. Same
  shape on the queue, the detail page and the board, so "what did the AI say
  here" is answered by recognition rather than by reading.
- **Flat rows over cards.** The board was 23 stacked cards each with an open
  form; it is now band-grouped rows with the decomposition behind a
  `<details>`. Nested cards are gone.
- **States:** empty states say, in product language, why the screen is empty and
  what would fill it; loading states are skeletons matching the row geometry they
  replace; errors name the failure and the recovery. Every screen on the demo
  path has all three, because a reviewer following README on a fresh clone hits
  the empty ones first.

## Copy

Written for a PM, not for the people who built it. The product UI carries no
internal vocabulary — no task IDs, no demo beat numbers, no ADR or doc paths, no
threshold symbols like `T_auto`, no shell commands — because every one of those
asks the reader to hold a second model of the system in their head just to read
a screen. The depth is not lost; it lives in the README, `docs/` and the code
comments, where someone looking for it is already looking.

Two rules make that concrete:

- **Name the outcome, not the column.** The database stores `needs_review` and a
  boolean; the screen says "confirmed as the same problem". The record keeps
  both values either way.
- **Keep the honest numbers, lose the jargon.** "Measured recall is 0.466" became
  "it catches a bit under half the duplicates it should", and the front door
  still says what the system gets wrong before a reviewer finds it. Plain
  language is not softer language.

The single exception is `app/error.tsx`: a crash screen is read by whoever is
running the project locally, and there the exact `npm run` recovery is the
kindest thing on the page.

## Bands

The ladder is four cut points over one score, and the cut points are a design
decision as much as a scoring one. `w1` put **10 of 23** problems in `now`,
which is a list rather than a prioritisation — the band stopped carrying
information. `w2` places the boundaries in the two widest gaps in the measured
distribution (0.815/0.780 among the leaders, 0.665/0.520 between the real
candidates and the tail), so `now` holds 4 and no boundary splits a cluster of
near-identical scores. Nothing in this build measures whether those cut points
are *right* — which is exactly why the weighting file is the PM's and every band
is overridable with a recorded reason.

## Motion

150 ms on hover/border/background only. No entrance choreography: the PM is
mid-task and the board is often already on a projector when it loads.

## Out of scope for E1

Dark mode ships as tokens but has no toggle (the scene is a lit meeting room, so
light is the default and the only path exercised). No charts — the board's job
is comparison between two rows, not a trend. No in-app weight editing
([D6](./PRODUCT.md#recorded-decisions)).
