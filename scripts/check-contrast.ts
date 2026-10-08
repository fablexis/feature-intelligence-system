/**
 * Measures every colour pair the design system asserts, in both themes.
 *
 *   npm run check:contrast
 *
 * The reference states a contrast claim in the `usage` field of nearly every
 * token ("4.5:1 como mínimo", "3:1 mínimo sobre `surface`"). Those are claims
 * until something checks them, and the one token that has to clear 3:1 against
 * three different backgrounds — `line-strong`, the border of every control —
 * turned out to be the one worth checking first.
 *
 * Reads the committed reference, not the CSS, so a drift between
 * `docs/design/reference/tokens.json` and `globals.css` shows up as a failure
 * here rather than as a slightly-too-pale border nobody measures.
 */
import { readFileSync } from 'node:fs';

const TOKENS = './docs/design/reference/tokens.json';

type Theme = 'light' | 'dark';
type RawToken = { name: string; value: Record<Theme, string>; usage?: string };

const raw = JSON.parse(readFileSync(TOKENS, 'utf8')) as {
  color: { tokens: RawToken[] };
};

/** `{accent}` in a token value means "the same as that token, this theme". */
function resolve(name: string, theme: Theme, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`circular token reference at ${name}`);
  seen.add(name);
  const token = raw.color.tokens.find((t) => t.name === name);
  if (!token) throw new Error(`unknown token: ${name}`);
  const value = token.value[theme];
  const alias = /^\{(.+)\}$/.exec(value);
  return alias ? resolve(alias[1], theme, seen) : value;
}

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
};

/** WCAG 2.1 relative luminance, then the standard (L1+.05)/(L2+.05). */
const luminance = ([r, g, b]: [number, number, number]) => {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};

function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(rgb(a)), luminance(rgb(b))];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * `need` is 4.5 for anything that carries words and 3 for borders, large text
 * and non-text indicators, per WCAG 1.4.3 and 1.4.11.
 */
const PAIRS: Array<{ fg: string; on: string; need: number; what: string }> = [
  // Body and secondary text, on every surface it can land on.
  ...['surface', 'surface-raised', 'surface-sunken', 'accent-tint'].flatMap((on) => [
    { fg: 'ink', on, need: 4.5, what: 'body text' },
    { fg: 'ink-muted', on, need: 4.5, what: 'secondary text' },
  ]),
  // The border of every control. Three surfaces, three chances to be too pale.
  ...['surface', 'surface-raised', 'surface-sunken'].map((on) => ({
    fg: 'line-strong',
    on,
    need: 3,
    what: 'control border',
  })),
  // The focus ring has to be visible wherever focus can land.
  ...['surface', 'surface-raised', 'surface-sunken', 'accent-tint'].map((on) => ({
    fg: 'focus-ring',
    on,
    need: 3,
    what: 'focus ring',
  })),
  { fg: 'on-accent', on: 'accent', need: 4.5, what: 'primary button label' },
  { fg: 'on-accent', on: 'accent-hover', need: 4.5, what: 'primary button, hovered' },
  { fg: 'on-accent-tint', on: 'accent-tint', need: 4.5, what: 'tinted chip label' },
  // The band ladder: each chip's own word against its own fill.
  { fg: 'on-band-now', on: 'band-now', need: 4.5, what: 'band now' },
  { fg: 'on-band-next', on: 'band-next', need: 4.5, what: 'band next' },
  { fg: 'on-band-later', on: 'band-later', need: 4.5, what: 'band later' },
  { fg: 'on-band-no', on: 'band-no', need: 4.5, what: 'band no' },
  { fg: 'band-later-line', on: 'band-later', need: 3, what: 'band later outline' },
  // Amber is the one colour with a reserved meaning; it has to read.
  { fg: 'on-flag', on: 'flag', need: 4.5, what: 'needs-review label' },
  { fg: 'flag-line', on: 'surface', need: 3, what: 'needs-review border' },
  { fg: 'flag-line', on: 'surface-raised', need: 3, what: 'needs-review border on a card' },
  { fg: 'destructive', on: 'surface', need: 4.5, what: 'reject label' },
  { fg: 'destructive', on: 'surface-raised', need: 4.5, what: 'reject label on a card' },
  { fg: 'destructive', on: 'destructive-tint', need: 4.5, what: 'reject label on its tint' },
  { fg: 'on-success-tint', on: 'success-tint', need: 4.5, what: 'confirmation label' },
  { fg: 'success', on: 'surface-raised', need: 4.5, what: 'success text' },
];

let failures = 0;
for (const theme of ['light', 'dark'] as const) {
  console.log(`\n${theme === 'light' ? 'Day' : 'Night'}`);
  for (const { fg, on, need, what } of PAIRS) {
    const r = ratio(resolve(fg, theme), resolve(on, theme));
    const ok = r >= need;
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (needs ${need})  ` +
        `${fg} on ${on}  — ${what}`,
    );
  }
}

console.log(
  failures === 0
    ? `\nAll ${PAIRS.length * 2} measured pairs clear their threshold.`
    : `\n${failures} of ${PAIRS.length * 2} pairs fall short.`,
);
process.exit(failures === 0 ? 0 : 1);
