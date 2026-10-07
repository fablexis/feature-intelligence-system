import Link from 'next/link';
import { connection } from 'next/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { listProblems, problemStats } from '@/problems/evidence';

/**
 * Beat 1 of the demo opens here: the corpus is not 55 asks, it is a set of
 * shared problems that nobody labelled.
 *
 * Ordered by **evidence strength** — distinct accounts affected — because that
 * is the only ranking this build has measured. C5 replaces the ordering with an
 * explainable score; the honest ordering until then is the raw count, not a
 * number that looks like a judgement but isn't one yet.
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
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div>
        <Link href="/" className="text-muted-foreground text-sm hover:underline">
          ← Home
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Problems</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {ranked.length} problems formed from {totals.requests} attached requests by the intake
          pipeline — nobody labelled these. {totals.needsReview} attachments are flagged for review
          because they landed below the auto-merge threshold. Ground truth for this corpus is 12, so
          the pipeline still over-splits; measured recall is 0.466 (
          <code>docs/eval-results.md</code>).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ordered by evidence strength</CardTitle>
          <CardDescription>
            Distinct accounts affected. Not a priority ranking — that needs the strategic and
            customer-value factors, which C5 adds. Popularity and value point in opposite
            directions, which is the trade this ordering deliberately does not yet resolve.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {ranked.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No problems yet. Run <code>npm run seed</code> then <code>npm run ingest</code>, or
              submit a request.
            </p>
          )}
          {ranked.map(({ problem, stats: s }) => (
            <Link
              key={problem.id}
              href={`/problems/${problem.id}`}
              className="hover:bg-muted/50 flex flex-col gap-1 rounded-md border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={s.strength > 1 ? 'default' : 'outline'}>
                  {s.strength} account{s.strength === 1 ? '' : 's'}
                </Badge>
                <span className="text-sm font-medium">{problem.statement}</span>
              </div>
              <span className="text-muted-foreground text-xs">
                {s.requestCount} request{s.requestCount === 1 ? '' : 's'}
                {s.supportOnlyAccounts > 0 && ` · ${s.supportOnlyAccounts} clicked`}
                {s.needsReview > 0 && ` · ${s.needsReview} needs review`}
                {s.detached > 0 && ` · ${s.detached} detached`}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
