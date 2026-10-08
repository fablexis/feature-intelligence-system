import Link from 'next/link';
import { connection } from 'next/server';
import { AppShell, EmptyState, Metric, PageHeader } from '@/components/shell';
import { Flag } from '@/components/signals';
import { db } from '@/db';
import { listProblems, problemStats } from '@/problems/evidence';

/**
 * Beat 1 of the demo opens here: the corpus is not 55 asks, it is a set of
 * shared problems that nobody labelled.
 *
 * Ordered by **evidence strength** — distinct accounts affected — because that
 * is the only ranking this screen has measured. The priority board resolves the
 * breadth-versus-value trade; this list deliberately does not, and says so.
 */
export const instant = false;

export default async function ProblemsPage() {
  /**
   * `instant = false` is not sufficient on this page, and `next build` proved
   * it: the route came out as `○ (Static)` with the real problem statements
   * baked into `.next/server/app/problems.html`, which would have frozen the
   * list at build time forever.
   *
   * The reason is worth recording. The detail page awaits `params` and
   * `searchParams`, which are request-time APIs, so Next knows it cannot be
   * prerendered. This page touches no such API, and a **synchronous**
   * better-sqlite3 read is invisible to Next's dynamic-read detection — so Next
   * concluded, reasonably, that there was nothing request-dependent here.
   * `connection()` is the explicit way to say otherwise.
   */
  await connection();

  const rows = listProblems(db);
  const stats = problemStats(
    db,
    rows.map((r) => r.id),
  );

  const ranked = rows
    .map((problem) => ({ problem, stats: stats.get(problem.id)! }))
    // Strength first, then breadth of requests; id last so the order is stable.
    .sort(
      (a, b) =>
        b.stats.strength - a.stats.strength ||
        b.stats.requestCount - a.stats.requestCount ||
        a.problem.id.localeCompare(b.problem.id),
    );

  const totals = ranked.reduce(
    (acc, r) => ({
      requests: acc.requests + r.stats.requestCount,
      needsReview: acc.needsReview + r.stats.needsReview,
    }),
    { requests: 0, needsReview: 0 },
  );

  return (
    <AppShell current="/problems" width="max-w-4xl">
      <PageHeader
        title="Problems"
        metrics={
          <>
            <Metric label="problems formed" value={ranked.length} hint="ground truth is 12" />
            <Metric label="requests attached" value={totals.requests} />
            <Metric label="flagged attaches" value={totals.needsReview} tone="flag" />
          </>
        }
      >
        Formed by the intake pipeline from raw text — nobody labelled these. Ordered by distinct
        accounts affected, which is breadth, not priority. Ground truth for this corpus is 12
        problems, so the pipeline still over-splits: measured recall is{' '}
        <span className="num font-mono">0.466</span> (
        <code className="font-mono text-xs">docs/eval-results.md</code>), and the gap is visible
        below as several small problems that are really one.
      </PageHeader>

      {ranked.length === 0 ? (
        <EmptyState
          title="No problems yet"
          command={'npm run seed\nnpm run ingest\nnpm run score'}
        >
          Seeding loads accounts and raw requests only — the database never contains the groupings
          it is measured on, so this list is empty until the pipeline forms them. You can also
          submit a request and watch one form.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranked.map(({ problem, stats: s }) => (
            <li key={problem.id}>
              <Link
                href={`/problems/${problem.id}`}
                className="hover:bg-muted/50 flex items-start gap-4 rounded-lg border p-4 transition-colors"
              >
                <span className="flex w-14 shrink-0 flex-col items-center">
                  <span className="num text-2xl leading-none font-semibold tracking-tight">
                    {s.strength}
                  </span>
                  <span className="text-muted-foreground text-[0.6875rem]">
                    account{s.strength === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="font-medium">{problem.statement}</span>
                  <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    <span className="num">
                      {s.requestCount} request{s.requestCount === 1 ? '' : 's'}
                    </span>
                    {s.supportOnlyAccounts > 0 && (
                      <span className="num">{s.supportOnlyAccounts} clicked</span>
                    )}
                    {s.detached > 0 && <span className="num">{s.detached} detached</span>}
                    {s.needsReview > 0 && (
                      <Flag>
                        {s.needsReview} need{s.needsReview === 1 ? 's' : ''} review
                      </Flag>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
