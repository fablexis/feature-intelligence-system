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
  confirmed: 'Confirmed — it stays on that problem, and your agreement is on record.',
  detached: 'Rejected — moved off that problem. The request itself is untouched.',
  'already-confirmed': 'That one was already confirmed. Nothing was recorded twice.',
  'already-detached': 'That one had already been rejected.',
  'confirm-detached': 'That one has already been rejected, so there is nothing to confirm.',
  'unknown-link': 'That request is no longer filed under this problem.',
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
            <Metric label="waiting on you" value={queue.length} tone="flag" />
            <Metric
              label="confidence needed to skip review"
              value={tAuto.toFixed(2)}
              hint="set from measured results"
            />
            <Metric label="problems" value={problemCount} />
          </>
        }
      >
        Each of these requests was filed against a problem that already existed, but the system was
        not confident enough to decide on its own. Wrongly merging two problems is the expensive
        mistake — the demand disappears into something else and nobody notices — so anything short
        of certain comes to you. Your answer is kept either way, including when you agree: if
        nothing were recorded when you say yes, there would be no way to tell a reviewed queue from
        an ignored one.
      </PageHeader>

      {note && NOTES[note] && <Note>{NOTES[note]}</Note>}

      {queue.length === 0 &&
        (problemCount === 0 ? (
          <EmptyState title="No problems yet">
            The sample company loads customer requests and no groupings, so there is nothing to
            review until the system has read them. The README has the setup steps.
          </EmptyState>
        ) : (
          <EmptyState title="Nothing waiting on you">
            Every match was either made confidently on its own or has already been confirmed or
            rejected here — and each of those answers is still on record.
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
                <span className="text-muted-foreground text-xs">filed by a person, not matched</span>
              )}
            </div>

            {item.degraded && <DegradedNotice where="this match" />}

            {/* What the PM is judging, in the submitter's own words. */}
            <div className="flex flex-col gap-1">
              <h2 className="font-medium">{item.title}</h2>
              <p className="max-w-[70ch] text-sm leading-relaxed">{item.bodyRaw}</p>
            </div>

            {/* Where the system put it. */}
            <div className="border-foreground/15 flex flex-col gap-1 border-l pl-4">
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Filed under
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
                Rejecting moves the request out of this problem. Nothing is deleted — the
                customer&rsquo;s words stay on the problem page, one click from being put back.
              </p>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
