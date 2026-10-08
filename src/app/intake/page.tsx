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
    <AppShell current="/intake" width="max-w-3xl">
      <PageHeader title="New request">
        Intake runs before a record exists, so a duplicate problem is caught at the one moment
        deduplication is free. A submitter has roughly 60 seconds of attention, so this has to
        return something useful inside the same interaction — not a ticket number.
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState title="No accounts to file against" command="npm run seed">
          Every request belongs to an account, and the seeded corpus is what supplies them. Load it
          and this form becomes usable.
        </EmptyState>
      ) : (
        <IntakeForm accounts={rows} />
      )}
    </AppShell>
  );
}
