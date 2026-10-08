/**
 * The chrome every demo-path screen shares — see [DESIGN](../../docs/DESIGN.md).
 *
 * One header, one container, one vocabulary for empty / loading / error. A PM
 * resuming triage mid-way needs the same three things in the same place on
 * every screen: where am I, what needs me, and where do I go next. The flagged
 * count rides in the nav for exactly that reason — it is the only number on
 * this product that means "a human owes this a look", so it is visible from
 * every screen rather than only from the one that lists it.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { db } from '@/db';
import { flaggedCount } from '@/problems/provenance';

const NAV = [
  { href: '/problems', label: 'Problems' },
  { href: '/priority', label: 'Priority' },
  { href: '/review', label: 'Review' },
  { href: '/intake', label: 'New request' },
] as const;

/**
 * `current` is matched by prefix, not equality, so a problem detail page still
 * highlights Problems.
 */
export function AppShell({
  current,
  children,
  width = 'max-w-5xl',
}: {
  current?: string;
  children: ReactNode;
  width?: string;
}) {
  const flagged = flaggedCount(db);
  return (
    <>
      <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className={`mx-auto flex ${width} flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3`}>
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Ledgerline <span className="text-muted-foreground font-normal">feature intelligence</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => {
              const active = current === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`hover:bg-muted rounded-md px-2 py-1 transition-colors ${
                    active ? 'bg-muted font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {item.label}
                  {item.href === '/review' && flagged > 0 && (
                    <span className="bg-flag text-flag-fg border-flag-border num ml-1.5 rounded-full border px-1.5 py-0.5 text-xs font-medium">
                      {flagged}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className={`mx-auto flex ${width} flex-col gap-8 px-6 pt-8 pb-16`}>{children}</main>
    </>
  );
}

/** Title, one sentence of what this screen is for, and the numbers behind it. */
export function PageHeader({
  title,
  children,
  metrics,
}: {
  title: string;
  children?: ReactNode;
  metrics?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && (
        <div className="text-muted-foreground max-w-[70ch] text-sm leading-relaxed">{children}</div>
      )}
      {metrics && <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-1">{metrics}</dl>}
    </div>
  );
}

/**
 * One number set large enough to read from across a room, with its label under
 * it rather than beside it — a label that wraps must not push the number.
 */
export function Metric({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'flag';
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dd
        className={`num text-2xl leading-none font-semibold tracking-tight ${
          tone === 'flag' ? 'text-flag-fg' : ''
        }`}
      >
        {value}
      </dd>
      <dt className="text-muted-foreground text-xs">
        {label}
        {hint && <span className="block opacity-80">{hint}</span>}
      </dt>
    </div>
  );
}

/**
 * Empty states name the command that fills them. A reviewer following README on
 * a fresh clone meets these before anything else, and "nothing here" would
 * leave them guessing whether the build is broken or the database is empty.
 */
export function EmptyState({
  title,
  children,
  command,
}: {
  title: string;
  children: ReactNode;
  command?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1.5 max-w-[55ch] text-sm leading-relaxed">
        {children}
      </p>
      {command && (
        <pre className="bg-muted mx-auto mt-4 w-fit rounded-md px-3 py-2 font-mono text-xs">
          {command}
        </pre>
      )}
    </div>
  );
}

/** A short confirmation or refusal from a Server Action, carried in the URL. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="bg-muted border-border rounded-md border px-3 py-2 text-sm"
    >
      {children}
    </p>
  );
}

/** Skeletons match the geometry of the rows they stand in for. */
export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border p-4">
          <div className="bg-muted h-7 w-16 animate-pulse rounded-md" />
          <div className="bg-muted h-4 flex-1 animate-pulse rounded" style={{ maxWidth: `${70 - i * 4}%` }} />
          <div className="bg-muted h-7 w-10 animate-pulse rounded-md" />
        </div>
      ))}
    </div>
  );
}
