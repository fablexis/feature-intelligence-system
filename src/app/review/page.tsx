import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { connection } from 'next/server';
import { Button } from '@/components/ui/button';
import { EmptyState, Metric, Note, PageHeader, AppShell } from '@/components/shell';
import { DegradedNotice, Flag, Measure, Provenance } from '@/components/signals';
import { db } from '@/db';
import { confirmFromReviewAction, rejectFromReviewAction } from '@/problems/actions';
import { listProblems } from '@/problems/evidence';
import { reviewQueue } from '@/problems/provenance';

/**
 * The PM review queue — [ADR 0005](../../../docs/adr/0005-duplicate-resolution-actor.md)'s
 * missing half, deferred out of C4 and built here.
 *
 * ADR 0005 splits duplicate resolution by confidence: at or above `T_auto` the
 * attach happens unattended, below it the submitter may attach but the
 * attachment is flagged, and the PM reviews a filtered queue of exactly those.
 * The flagged population has been countable since C3 and visible as a count on
 * the problem list — but a count is not a review, and until this screen existed
 * the design's one precision safeguard had no place to happen.
 *
 * The screen is ordered around what the decision actually needs: the verbatim
 * request first, because that is what the PM is judging; then the problem it
 * landed in; then what the model said and how sure it was. Confirm and reject
 * are the same two mutations the detail page uses, so the two screens cannot
 * drift apart on what rejection means.
 */
export const instant = false;

const NOTES: Record<string, string> = {
  confirmed: 'Confirmed. The attach stands, the flag is cleared, and the agreement is on record.',
  detached:
    'Rejected. The attach is un-merged, the request text is intact, and the suggestion is marked rejected.',
  'already-confirmed': 'That one was already confirmed. Nothing was recorded twice.',
  'already-detached': 'That attach was already un-merged.',
  'confirm-detached': 'That attach has already been un-merged, so there is nothing to confirm.',
  'unknown-link': 'That evidence link no longer exists.',
};

const SOURCE_LABEL: Record<string, string> = {
  csm_note: 'CSM note',
  ae_note: 'AE note',
  support_ticket: 'support ticket',
  internal: 'internal note',
  customer_direct: 'customer wrote in',
};

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }>;
}) {
  // A synchronous SQLite read is invisible to Next's dynamic-read detection,
  // so without this the queue would be baked at build time. See /problems.
  await connection();
  const { note } = await searchParams;

  const thresholds = JSON.parse(readFileSync('./config/thresholds.json', 'utf8'));
  const tAuto = Number(thresholds.tAuto);
  const queue = reviewQueue(db);
  const problemCount = listProblems(db).length;

  return (
    <AppShell current="/review">
      <PageHeader
        title="Review queue"
        metrics={
          <>
            <Metric label="flagged attaches" value={queue.length} tone="flag" />
            <Metric label="T_auto" value={tAuto.toFixed(2)} hint="chosen from the eval curve" />
            <Metric label="problems" value={problemCount} />
          </>
        }
      >
        Every attach below <code className="font-mono">T_auto</code> landed here instead of standing
        unattended. A false merge hides demand and is nearly undetectable afterwards, so the
        pipeline is tuned for precision and routes the uncertain band to a human — this screen is
        that human&rsquo;s half of the bargain (
        <code className="font-mono text-xs">docs/adr/0005</code>). Confirming and rejecting are
        both recorded: an override rate near zero would mean the
        reviewing stopped, which is a product failure, not a success.
      </PageHeader>

      {note && NOTES[note] && <Note>{NOTES[note]}</Note>}

      {queue.length === 0 &&
        (problemCount === 0 ? (
          <EmptyState
            title="No problems have been formed yet"
            command={'npm run seed\nnpm run ingest\nnpm run score'}
          >
            Seeding loads accounts and raw requests only — the database never contains the
            groupings it is measured on. Run the pipeline and the flagged attaches appear here.
          </EmptyState>
        ) : (
          <EmptyState title="Queue clear">
            Nothing is waiting on a human. Every attach either cleared{' '}
            <code className="font-mono">T_auto</code> on its own or has already been confirmed or
            rejected — and each of those decisions is still on record.
          </EmptyState>
        ))}

      <div className="flex flex-col gap-4">
        {queue.map((item) => (
          <article key={item.linkId} className="flex flex-col gap-4 rounded-xl border p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Flag>needs review</Flag>
              <span className="text-sm font-medium">
                {item.accountName ?? 'internal'}
                {item.segment && (
                  <span className="text-muted-foreground font-normal"> · {item.segment}</span>
                )}
              </span>
              {item.arrUsd !== null && item.arrUsd > 0 && (
                <Measure label="ARR" value={usd(item.arrUsd)} />
              )}
              <span className="text-muted-foreground text-xs">
                {SOURCE_LABEL[item.source] ?? item.source}
              </span>
              {item.createdBy === 'human' && (
                <span className="text-muted-foreground text-xs">attached by a human</span>
              )}
            </div>

            {item.degraded && <DegradedNotice where="this match" />}

            {/* What the PM is judging, in the submitter's own words. */}
            <div className="flex flex-col gap-1">
              <h2 className="font-medium">{item.title}</h2>
              <p className="max-w-[70ch] text-sm leading-relaxed">{item.bodyRaw}</p>
            </div>

            {/* Where the pipeline put it. */}
            <div className="border-foreground/15 flex flex-col gap-1 border-l pl-4">
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Attached to
              </span>
              <Link
                href={`/problems/${item.problemId}`}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                {item.problemStatement}
              </Link>
              <p className="text-muted-foreground max-w-[70ch] text-sm">
                Workaround today: {item.problemWorkaround}
              </p>
            </div>

            <Provenance
              verdict={item.verdict}
              confidence={item.verdictConfidence}
              similarity={item.similarity ?? item.linkConfidence}
              rationale={item.rationale}
            />

            <div className="flex flex-wrap items-center gap-2">
              <form action={confirmFromReviewAction}>
                <input type="hidden" name="linkId" value={item.linkId} />
                <Button type="submit" size="lg">
                  Confirm — same problem
                </Button>
              </form>
              <form action={rejectFromReviewAction}>
                <input type="hidden" name="linkId" value={item.linkId} />
                <Button type="submit" size="lg" variant="destructive">
                  Reject — not the same problem
                </Button>
              </form>
              <p className="text-muted-foreground text-xs">
                Rejecting un-merges; it never deletes. The request text survives verbatim and is one
                click from being re-attached.
              </p>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
