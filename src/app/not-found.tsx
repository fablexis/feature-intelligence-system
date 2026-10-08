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
        Problem ids are derived from the request that formed them, so re-running{' '}
        <code className="font-mono">npm run ingest</code> rebuilds the set and retires the old ids.
        Nothing was deleted — the requests behind it are intact and have been re-grouped.
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
