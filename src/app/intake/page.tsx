import { asc } from 'drizzle-orm';
import { connection } from 'next/server';
import { AppShell, EmptyState, PageHeader } from '@/components/shell';
import { db } from '@/db';
import { accounts } from '@/db/schema';
import { IntakeForm } from './intake-form';

/**
 * Blocking (not prerendered): this page reads live database state, so baking
 * it at build time would freeze the data. Next 16 prerenders by default with
 * Cache Components on, and the production build rejects uncached reads —
 * which is the correct complaint, caught by `next build` and not by `next dev`.
 */
export const instant = false;

export const metadata = { title: 'New request' };

export default async function IntakePage() {
  // A synchronous SQLite read is invisible to Next's dynamic-read detection,
  // so without this the account list and the nav's flagged count would be
  // baked at build time. See /problems for the full account of that.
  await connection();

  const rows = db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .orderBy(asc(accounts.name))
    .all();

  return (
    <AppShell current="/intake">
      {/*
        The explanation lives here and only here. It used to be repeated on the
        form card below, which made a 60-second submitter read the same sentence
        twice before reaching the first field.
      */}
      <PageHeader eyebrow="New request" title="File a request">
        File it the way a CSM would, minutes after a call. Before anything is saved, this checks
        whether the problem underneath is one other customers have already raised — so you find out
        inside the same minute, instead of getting a ticket number and hearing nothing.
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState title="No accounts to file against">
          Every request belongs to a customer account, and the sample company is what supplies
          them. The README has the setup steps.
        </EmptyState>
      ) : (
        <IntakeForm accounts={rows} />
      )}
    </AppShell>
  );
}
