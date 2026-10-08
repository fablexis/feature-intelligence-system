/**
 * The chrome every screen shares — see [DESIGN](../../docs/DESIGN.md) and the
 * Shell mockup in `docs/design/reference/components/Shell/`.
 *
 * Three shapes, one markup, switched by CSS in `globals.css`: a 264px sidebar
 * from 1100px, an 88px icon rail from 700, and below that no sidebar at all —
 * a 60px header and a floating tab bar, because a sidebar on a phone is a
 * drawer nobody opens.
 *
 * Navigation does not move between views. "New request" is the only filled
 * button in the sidebar, and the flagged count rides in the nav in amber
 * because it is the one number that means "a person owes this a look".
 */
import { ChartColumn, House, Inbox, Layers, Plus } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { db } from '@/db';
import { flaggedCount } from '@/problems/provenance';

const NAV = [
  { href: '/', label: 'Overview', Icon: House },
  { href: '/problems', label: 'Problems', Icon: Layers },
  { href: '/priority', label: 'Priority', Icon: ChartColumn },
  { href: '/review', label: 'Review', Icon: Inbox },
] as const;

/** Prefix match, so a problem detail page still highlights Problems. */
const isCurrent = (href: string, current?: string) =>
  href === '/' ? current === '/' : current?.startsWith(href);

export function AppShell({ current, children }: { current?: string; children: ReactNode }) {
  const flagged = flaggedCount(db);

  return (
    <div className="app">
      <aside className="side">
        <div className="side-in">
          <Link href="/" className="brand">
            <i aria-hidden />
            <b className="rail-hide">Ledgerline</b>
          </Link>

          <Link
            href="/intake"
            className="btn btn-primary btn-lg w-full"
          >
            <Plus className="size-5 shrink-0" aria-hidden />
            <span className="rail-hide">New request</span>
          </Link>

          <nav className="nav">
            {NAV.map(({ href, label, Icon }) => {
              const active = isCurrent(href, current);
              return (
                <Link key={href} href={href} aria-current={active ? 'page' : undefined}>
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <span className="rail-hide">{label}</span>
                  {href === '/review' && flagged > 0 && (
                    <>
                      <span className="count num rail-hide">{flagged}</span>
                      {/* The rail has no room for the number, so it keeps the colour. */}
                      <span className="rail-dot" aria-hidden />
                    </>
                  )}
                </Link>
              );
            })}
          </nav>

          <p className="side-foot rail-hide">
            Showing <b className="text-ink font-semibold">Ledgerline</b>, the sample company
            loaded on this machine.
          </p>
        </div>
      </aside>

      <header className="mobile-top">
        <Link href="/" className="brand">
          <i aria-hidden />
          <b>Ledgerline</b>
        </Link>
      </header>

      <main className="main">
        <div className="main-in">{children}</div>
      </main>

      <nav className="tabbar" aria-label="Sections">
        {NAV.map(({ href, label, Icon }) => {
          const active = isCurrent(href, current);
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined}>
              <Icon className="size-5" aria-hidden />
              {label === 'Overview' ? 'Home' : label}
              {href === '/review' && flagged > 0 && <span className="count num">{flagged}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Eyebrow, title, one-line lede — the same three things on every page, in the
 * same order, so a PM resuming triage knows where they are without reading.
 */
export function PageHeader({
  eyebrow,
  title,
  children,
  metrics,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  metrics?: ReactNode;
}) {
  return (
    <div className="pghead">
      <div className="pghead-main">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="h1">{title}</h1>
        {children && <p className="lede">{children}</p>}
      </div>
      {metrics && (
        <dl className="pghead-metrics">{metrics}</dl>
      )}
    </div>
  );
}

/** One number set large enough to read from across a room. */
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
    <div className="flex flex-col gap-1">
      <dd className={`numeral-lg num ${tone === 'flag' ? 'text-on-flag' : ''}`}>{value}</dd>
      <dt className="text-ink-muted body-sm">
        {label}
        {hint && <span className="block opacity-80">{hint}</span>}
      </dt>
    </div>
  );
}

/**
 * Empty states say, in the product's own language, why a screen is empty and
 * what would fill it — never "nothing here", which leaves a reader guessing
 * whether the build is broken or the data has not been loaded.
 */
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-line-strong rounded-[var(--radius-lg-v)] border border-dashed px-6 py-12 text-center">
      <p className="h2">{title}</p>
      <p className="text-ink-muted mx-auto mt-3 max-w-[55ch] leading-relaxed">{children}</p>
    </div>
  );
}

/** A short confirmation or refusal from a Server Action, carried in the URL. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="bg-surface-sunken rounded-[var(--radius-md-v)] px-4 py-3 text-sm"
    >
      {children}
    </p>
  );
}

/** Skeletons hold the shape of the content they stand in for, so nothing jumps. */
export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="bg-surface-raised ring-line flex items-center gap-5 rounded-[var(--radius-lg-v)] p-6 ring-1"
        >
          <span className="skel h-10 w-14" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="skel h-4" style={{ width: `${70 - i * 4}%` }} />
            <span className="skel h-3 w-2/5" />
          </span>
          <span className="skel h-7 w-20" />
        </div>
      ))}
    </div>
  );
}
