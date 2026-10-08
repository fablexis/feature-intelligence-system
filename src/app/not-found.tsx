import Link from 'next/link';

/**
 * Reachable in one real way: a problem id that no longer exists, usually
 * because `npm run ingest` rebuilt the problem set under a bookmarked URL.
 * Formation is order-dependent, so ids do not survive a re-ingest — which is
 * worth saying here rather than leaving as a dead link.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">No such problem</h1>
      <p className="text-muted-foreground max-w-[70ch] text-sm leading-relaxed">
        This link points at a problem that no longer exists under that name. Nothing was deleted —
        when the system re-reads every request it regroups them from scratch, so the problems
        are rebuilt and the old links retire. The customer requests behind it are all still there.
      </p>
      <div className="flex gap-2">
        <Link
          href="/problems"
          className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors"
        >
          All problems
        </Link>
        <Link
          href="/priority"
          className="hover:bg-muted inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors"
        >
          Priority board
        </Link>
      </div>
    </main>
  );
}
