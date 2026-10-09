/**
 * The signals this product is accountable for, each with exactly one shape —
 * see [DESIGN](../../docs/DESIGN.md) and the Signals mockup in
 * `docs/design/reference/components/Signals/`.
 *
 *  - **Band** — the ranking, as an ordinal ladder. Always carries its word, so
 *    colour is never the only carrier of meaning.
 *  - **Measure** — anything the system computed, in mono so digits compare.
 *  - **Meter** — a bar that fills, with a tick where the threshold sits.
 *  - **Provenance** — what the model concluded, how sure it was, and why.
 *  - **Flag** — `needs review` and the degraded path. Amber is reserved for
 *    these two; decorative use anywhere would make the label stop meaning
 *    anything.
 */
import type { ReactNode } from 'react';
import { Expand } from './expand';

export type BandName = 'now' | 'next' | 'later' | 'no';

const BAND_CLASS: Record<BandName, string> = {
  now: 'band-now',
  next: 'band-next',
  later: 'band-later',
  no: 'band-no',
};

/**
 * Display size is spent here and on the account count beside it, and nowhere
 * else: the board is read off a projector, and band against breadth is the one
 * comparison that has to survive the distance.
 */
export function BandChip({ band, size = 'sm' }: { band: BandName | null; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`band ${size === 'lg' ? 'band-lg' : ''} ${
        band ? BAND_CLASS[band] : 'band-unscored'
      }`}
    >
      {band ?? 'unscored'}
    </span>
  );
}

/** A computed number, in mono, with its name. Never a bare float. */
export function Measure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="text-ink-muted body-sm whitespace-nowrap">
      {label} <span className="measure text-ink">{value}</span>
    </span>
  );
}

/** The amber count badge, for a number that means "a person owes this a look". */
export function CountBadge({ children }: { children: ReactNode }) {
  return <span className="count num">{children}</span>;
}

/**
 * A bar that fills from the left, with an optional tick at the threshold.
 *
 * `value` and `threshold` are 0–1. The tick is what turns "0.77" from a number
 * into "below the line", which is the only reading that matters on the queue.
 */
export function Meter({
  value,
  threshold,
  tone = 'accent',
  label,
}: {
  value: number;
  threshold?: number;
  tone?: 'accent' | 'later';
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="meter"
      role="img"
      aria-label={
        label ??
        `${value.toFixed(3)}${threshold !== undefined ? ` against a threshold of ${threshold.toFixed(2)}` : ''}`
      }
    >
      <i
        style={{
          width: `${pct}%`,
          ...(tone === 'later' ? { background: 'var(--band-later-line)' } : null),
        }}
      />
      {threshold !== undefined && <u style={{ left: `${threshold * 100}%` }} />}
    </div>
  );
}

const VERDICT_LABEL: Record<string, string> = {
  same: 'the same problem',
  related: 'related, but not the same',
  distinct: 'a different problem',
};

/**
 * What the AI concluded, beside the verbatim request it concluded it about.
 *
 * PRODUCT's acceptance property #2: a merge the PM cannot audit is one they
 * should not accept. The reason sits behind "Why" because it is what you open
 * when you disagree, not what you scan — and the rationale is rendered as plain
 * escaped text, because it is model output derived from untrusted request text
 * and is data, never instruction.
 */
export function Provenance({
  verdict,
  confidence,
  similarity,
  similarityLabel = 'text similarity',
  rationale,
}: {
  verdict: string | null;
  confidence: number | null;
  similarity: number | null;
  similarityLabel?: string;
  rationale: string | null;
}) {
  return (
    <div className="prov">
      <div className="prov-row">
        <b className="body-strong">
          The AI read this as {verdict ? (VERDICT_LABEL[verdict] ?? verdict) : 'unjudged'}
        </b>
        {confidence !== null && <Measure label="confidence" value={confidence.toFixed(2)} />}
        {similarity !== null && (
          <Measure label={similarityLabel} value={similarity.toFixed(3)} />
        )}
        {rationale && (
          <Expand label="Why">
            <p>{rationale}</p>
          </Expand>
        )}
      </div>
    </div>
  );
}

/**
 * The database stores a column name and a boolean; a PM needs the sentence.
 *
 * `human_overrides` is append-only (M3) and keeps both the old and the new
 * value, so where a plain outcome reads better that is what is shown; where the
 * before matters — a band moved from one rung to another — both are rendered.
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
    <p className="change">
      <span>
        {outcome ?? (
          <span className="num">
            {field} {from ?? '—'} → {to ?? '—'}
          </span>
        )}
        {reason && <span className="text-ink-muted"> · {reason}</span>}
        <span className="text-ink-muted"> — {actor}</span>
      </span>
    </p>
  );
}

/** `needs review` / `degraded`, as a chip. Amber is reserved for these. */
export function Flag({ children }: { children: ReactNode }) {
  return <span className="flag">{children}</span>;
}

/** A confirmation that something was kept. Always a word, never only a colour. */
export function Chip({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return <span className={`chip ${ok ? 'chip-ok' : ''}`}>{children}</span>;
}

/**
 * The degraded path, stated at full size rather than as a chip.
 *
 * [D5](../../docs/PRODUCT.md#d5-revised--recordreplay-not-synthetic-embeddings)
 * is explicit that this path is labelled rather than hidden: a reviewer must
 * never be shown a degraded result dressed as the real one.
 */
export function DegradedNotice({ where = 'this result' }: { where?: string }) {
  return (
    <div className="card card-flag">
      <p className="h3">Reduced accuracy — this is not the real matching</p>
      <p className="mt-2 max-w-[70ch] leading-relaxed">
        Running without an API key, {where} fell back to comparing letters rather than meaning. That
        fallback <strong>cannot</strong> spot two people describing the same problem in different
        words, which is the one thing this product is for. Everything in the sample company is
        covered; free-typed text outside it is not. The README explains how to add a free key.
      </p>
    </div>
  );
}
