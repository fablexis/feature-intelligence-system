import Link from 'next/link';
import { connection } from 'next/server';
import { AppShell, EmptyState, Metric, PageHeader } from '@/components/shell';
import { db } from '@/db';
import { requests } from '@/db/schema';
import { listProblems, problemStats } from '@/problems/evidence';
import { flaggedCount } from '@/problems/provenance';

/**
 * The front door, which for this project means **the first screen of the demo
 * path**: a reviewer opens `localhost:3000` with the README in the other
 * window, and what they need is where to start and what each screen proves.
 *
 * E1 replaced a build-progress checklist that was honest but served the author
 * rather than the reader — TASKS.md and the README carry that, and better.
 */
export const instant = false;

const SCREENS = [
  {
    href: '/problems',
    label: 'Problems',
    beat: 'Beat 1',
    line: 'The corpus is not N asks — it is a set of shared problems, each backed by the verbatim requests that formed it.',
  },
  {
    href: '/priority',
    label: 'Priority',
    beat: 'Beat 2',
    line: 'Popularity and value point in opposite directions. Band and account count sit side by side so the trade is visible, not asserted.',
  },
  {
    href: '/intake',
    label: 'New request',
    beat: 'Beat 3',
    line: 'The centerpiece. Type a request that shares no vocabulary with anything in the corpus and watch it find its problem anyway.',
  },
  {
    href: '/review',
    label: 'Review queue',
    beat: 'ADR 0005',
    line: 'Attaches below the auto threshold wait here for a human. Confirming and rejecting are both recorded.',
  },
] as const;

export default async function Home() {
  await connection();

  const problems = listProblems(db);
  const stats = problemStats(
    db,
    problems.map((p) => p.id),
  );
  const requestCount = db.select({ id: requests.id }).from(requests).all().length;
  const attached = [...stats.values()].reduce((n, s) => n + s.requestCount, 0);
  const flagged = flaggedCount(db);

  return (
    <AppShell width="max-w-3xl">
      <PageHeader
        title="Feature intelligence"
        metrics={
          problems.length > 0 ? (
            <>
              <Metric label="raw requests" value={requestCount} />
              <Metric label="problems formed" value={problems.length} />
              <Metric label="attached as evidence" value={attached} />
              <Metric label="awaiting review" value={flagged} tone="flag" />
            </>
          ) : undefined
        }
      >
        A feature request is not a unit of demand — it is a piece of evidence about demand. This
        tool extracts the problem underneath each request, groups requests that share one however
        differently they are worded, and ranks the problems with a decomposition a PM can argue
        with.
      </PageHeader>

      {problems.length === 0 && (
        <EmptyState
          title="The database has no problems in it yet"
          command={'npm run seed\nnpm run ingest\nnpm run score'}
        >
          Seeding loads accounts and raw requests only — deliberately, so the database never
          contains the groupings the eval measures it on. The problems below exist because the
          pipeline formed them.
        </EmptyState>
      )}

      <ul className="flex flex-col gap-2">
        {SCREENS.map((screen) => (
          <li key={screen.href}>
            <Link
              href={screen.href}
              className="hover:bg-muted/50 group flex flex-col gap-1 rounded-lg border p-4 transition-colors"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium underline-offset-4 group-hover:underline">
                  {screen.label}
                </span>
                <span className="text-muted-foreground text-xs tracking-wide uppercase">
                  {screen.beat}
                </span>
              </span>
              <span className="text-muted-foreground max-w-[70ch] text-sm leading-relaxed">
                {screen.line}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground max-w-[70ch] text-sm leading-relaxed">
        The honest numbers, up front: ground truth for the seeded corpus is 12 problems and the
        pipeline forms 23, so it over-splits — measured recall{' '}
        <span className="num font-mono">0.466</span>, auto-band precision{' '}
        <span className="num font-mono">1.000</span>, zero false merges. Precision is the one that
        matters, because a false merge hides demand invisibly. Full derivation in{' '}
        <code className="font-mono text-xs">docs/eval-results.md</code>.
      </p>
    </AppShell>
  );
}
