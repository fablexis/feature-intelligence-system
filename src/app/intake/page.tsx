import { asc } from 'drizzle-orm';
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

export default function IntakePage() {
  const rows = db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .orderBy(asc(accounts.name))
    .all();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">New request</h1>
      <p className="text-muted-foreground mt-1 mb-6 text-sm">
        Ledgerline · intake runs before a record exists, so duplicates are caught at the one moment
        deduplication is free.
      </p>
      <IntakeForm accounts={rows} />
    </main>
  );
}
