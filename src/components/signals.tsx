/**
 * The four signals this product is accountable for, each with exactly one
 * shape — see [DESIGN](../../docs/DESIGN.md).
 *
 *  - **Band** — the ranking, as an ordinal ladder rather than four colors.
 *  - **Measure** — anything the system computed, in mono so digits compare.
 *  - **Provenance** — what the model said, with its confidence and its basis.
 *  - **Flag** — `needs review` and the degraded path, the two things PRODUCT
 *    promised never to hide. Amber is reserved for these; using it anywhere
 *    decorative would make the degraded label stop meaning anything.
 */
import type { ReactNode } from 'react';

export type BandName = 'now' | 'next' | 'later' | 'no';

const BAND_CLASS: Record<BandName, string> = {
  now: 'bg-band-now text-band-now-fg border-transparent',
  next: 'bg-band-next text-band-next-fg border-transparent',
  later: 'bg-band-later text-band-later-fg border-border',
  no: 'bg-band-no text-band-no-fg border-border',
};

/**
 * Display size is spent here and nowhere else: PRODUCT's scene has this board
 * on a projector, and band plus account count is the one comparison that has to
 * survive the distance (DEMO Beat 2).
 */
export function BandChip({
  band,
  size = 'sm',
}: {
  band: BandName | null;
  size?: 'sm' | 'lg';
}) {
  const label = band ?? 'unscored';
  const cls = band ? BAND_CLASS[band] : 'bg-background text-muted-foreground border-dashed';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md border font-semibold uppercase ${cls} ${
        size === 'lg'
          ? 'h-10 min-w-[5.5rem] px-3 text-base tracking-wider'
          : 'h-6 px-2 text-xs tracking-wide'
      }`}
    >
      {label}
    </span>
  );
}

/** A computed number, in mono, with its name. Never a bare float. */
export function Measure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="text-muted-foreground text-xs whitespace-nowrap">
      {label} <span className="num text-foreground font-mono">{value}</span>
    </span>
  );
}

const VERDICT_CLASS: Record<string, string> = {
  same: 'bg-band-now text-band-now-fg',
  related: 'bg-band-next text-band-next-fg',
  distinct: 'bg-muted text-muted-foreground',
};

/** The stored enum, said the way a PM would say it. */
const VERDICT_LABEL: Record<string, string> = {
  same: 'the same problem',
  related: 'related, but not the same',
  distinct: 'a different problem',
};

/**
 * What the AI said, next to the verbatim request it said it about.
 *
 * PRODUCT's acceptance property #2: a merge the PM cannot audit is one they
 * should not accept. So the verdict, its confidence, the cosine that retrieved
 * the candidate and the rationale appear together — and the rationale is
 * rendered as plain escaped text, because it is model output derived from
 * untrusted request text and is data, never instruction.
 */
export function Provenance({
  verdict,
  confidence,
  similarity,
  similarityLabel = 'text similarity',
  rationale,
  promptVersion,
  modelId,
}: {
  verdict: string | null;
  confidence: number | null;
  similarity: number | null;
  /** Plain-language name for the number; the one at intake is a different scalar. */
  similarityLabel?: string;
  rationale: string | null;
  promptVersion?: string | null;
  modelId?: string | null;
}) {
  return (
    <div className="bg-muted/40 border-border flex flex-col gap-1.5 rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          What the AI concluded
        </span>
        {verdict && (
          <span
            className={`inline-flex h-5 items-center rounded px-1.5 text-xs font-semibold ${
              VERDICT_CLASS[verdict] ?? 'bg-muted text-muted-foreground'
            }`}
          >
            {VERDICT_LABEL[verdict] ?? verdict}
          </span>
        )}
        {confidence !== null && <Measure label="confidence" value={confidence.toFixed(2)} />}
        {similarity !== null && (
          <Measure label={similarityLabel} value={similarity.toFixed(3)} />
        )}
      </div>
      {rationale && <p className="text-sm leading-relaxed">{rationale}</p>}
      {(promptVersion || modelId) && (
        <p className="text-muted-foreground font-mono text-[0.6875rem]">
          {[modelId, promptVersion].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}

/**
 * The database stores a column name and a boolean; a PM needs the sentence.
 *
 * `human_overrides` is append-only (M3) and keeps both the old and the new
 * value, so where a plain outcome reads better ("removed from this problem")
 * that is what is shown; where the before matters — a band moved from one
 * rung to another — both are rendered.
 */
const OUTCOME: Record<string, string> = {
  'active:false': 'removed from this problem',
  'active:true': 'put back on this problem',
  'needs_review:false': 'confirmed as the same problem',
  'needs_review:true': 'flagged for review',
  'problemId:*': 'moved out into its own problem',
};

export function HumanChange({
  field,
  from,
  to,
  reason,
  actor,
}: {
  field: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  actor: string;
}) {
  const outcome = OUTCOME[`${field}:${to}`] ?? OUTCOME[`${field}:*`];
  return (
    <p className="border-foreground/15 border-l pl-3 text-sm">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Changed by a person
      </span>{' '}
      {outcome ?? (
        <span className="num">
          {field} {from ?? '—'} → {to ?? '—'}
        </span>
      )}
      {reason && <span className="text-muted-foreground"> · {reason}</span>}
      <span className="text-muted-foreground"> — {actor}</span>
    </p>
  );
}

/** `needs review` / `degraded`, as a chip. Amber is reserved for these. */
export function Flag({ children }: { children: ReactNode }) {
  return (
    <span className="bg-flag text-flag-fg border-flag-border inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-semibold">
      {children}
    </span>
  );
}

/**
 * The degraded path, stated at full size rather than as a chip.
 *
 * [D5](../../docs/PRODUCT.md#d5-revised--recordreplay-not-synthetic-embeddings)
 * is explicit that this path is labelled rather than hidden: a reviewer must
 * never be shown a degraded result dressed as the real one. So it gets a
 * border, the reserved hue, and a sentence naming the capability it loses.
 */
export function DegradedNotice({ where = 'this result' }: { where?: string }) {
  return (
    <div className="bg-flag text-flag-fg border-flag-border rounded-md border p-3">
      <p className="text-sm font-semibold">Reduced accuracy — this is not the real matching</p>
      <p className="mt-1 max-w-[70ch] text-sm leading-relaxed">
        Running without an API key, {where} fell back to comparing letters rather than meaning. That
        fallback <strong>cannot</strong> spot two people describing the same problem in different
        words, which is the one thing this product is for. Everything in the sample company is
        covered; free-typed text outside it is not. The README explains how to add a free key.
      </p>
    </div>
  );
}
