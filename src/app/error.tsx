'use client';

/**
 * The error state a reviewer is most likely to hit, and the reason it names a
 * command instead of apologising: on a fresh clone the overwhelmingly common
 * failure is an un-migrated or un-ingested database, which surfaces here as a
 * SQLite error from a synchronous read. "Something went wrong" would send them
 * to the issue tracker; the recovery is three commands.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">This screen could not be read</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        The page reads SQLite synchronously at request time, so a missing table or an empty database
        fails here rather than rendering blank. If this is a fresh clone, the database has not been
        migrated and filled yet:
      </p>
      <pre className="bg-muted rounded-md p-3 font-mono text-xs">
        {'npm run db:migrate\nnpm run seed\nnpm run ingest\nnpm run score'}
      </pre>
      <p className="bg-muted border-border overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs">
        {error.message}
      </p>
      <div>
        <button
          onClick={reset}
          className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
