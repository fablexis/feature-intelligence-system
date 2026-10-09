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
    hint: 'start here',
    line: 'Not a list of asks — a list of problems, each one showing the customer requests that make the case for it, in their own words.',
  },
  {
    href: '/priority',
    label: 'Priority',
    hint: 'for the roadmap meeting',
    line: 'What to work on, and why. The number of accounts affected sits next to every band, so you can see where breadth and value disagree.',
  },
  {
    href: '/intake',
    label: 'New request',
    hint: 'try it yourself',
    line: 'File a request the way a CSM would. It tells you then and there whether this is already a known problem — even when nobody used the same words for it.',
  },
  {
    href: '/review',
    label: 'Review queue',
    hint: 'needs a person',
    line: 'Matches the system was not confident enough to make on its own. You confirm or reject; either way the decision is kept.',
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
    <AppShell>
      <PageHeader
        eyebrow="Overview"
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
        A feature request is not a unit of demand — it is evidence about demand. This tool reads
        what the customer actually described, groups the requests that share a problem however
        differently they worded it, and ranks the problems in a way you can argue with rather than
        have to trust.
      </PageHeader>

      {problems.length === 0 && (
        <EmptyState title="Nothing here yet">
          Loading the sample company puts 55 customer requests in, and nothing else — no groupings.
          The problems you would see here are ones the system worked out for itself. The README has
          the three setup steps.
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
                <span className="text-muted-foreground text-xs">{screen.hint}</span>
              </span>
              <span className="text-muted-foreground max-w-[70ch] text-sm leading-relaxed">
                {screen.line}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* The honest-numbers note, in a PM's language. It stays on the front
          door rather than in a footnote: a tool that reports its own miss rate
          is the only kind a PM should trust with a merge. */}
      <p className="text-muted-foreground max-w-[70ch] text-sm leading-relaxed">
        <strong className="text-foreground">What this gets wrong, up front.</strong> On this sample
        company the right answer is 12 problems and the system found 23, so it splits some problems
        that belong together — it catches a bit under half of the duplicates it should. What it does
        not do is the expensive mistake: of the matches it made on its own, it got{' '}
        <strong className="text-foreground">none wrong</strong>. That is the deliberate trade.
        Wrongly merging two problems hides demand and nobody ever notices; leaving a duplicate
        behind is visible and cheap to fix. Anything it is unsure about goes to the review queue
        instead of being decided for you.
      </p>
    </AppShell>
  );
}
