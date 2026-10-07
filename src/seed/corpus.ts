/**
 * Loading the demo corpus into a database: accounts and raw requests, nothing
 * else.
 *
 * This module deliberately does NOT import `./labels`. Problems and evidence
 * links come into existence only by running the intake pipeline over these
 * requests, so no database the project builds — the demo one or the eval's
 * ephemeral one — can contain the answers it is measured on. `seed.test.ts`
 * enforces the non-import on this file and on `scripts/seed.ts`.
 *
 * It lives here rather than in `scripts/seed.ts` because C7's harness needs the
 * same corpus in a throwaway database, and two copies of "what the corpus is"
 * would be two things to keep in step.
 *
 * Idempotent: ids are derived from the fixture slugs and inserts are
 * conflict-tolerant, so re-running changes nothing.
 */
import type { Db } from '../db/index';
import { accounts, requests } from '../db/schema';
import { SEED_ACCOUNTS, accountIdFor } from './accounts';
import { SEED_REQUESTS, requestIdFor } from './requests';

export function insertCorpus(db: Db): { accounts: number; requests: number } {
  db.insert(accounts)
    .values(
      SEED_ACCOUNTS.map((a) => ({
        id: accountIdFor(a.slug),
        name: a.name,
        segment: a.segment,
        arrCents: a.arrCents,
        renewalDate: a.renewalDate ? new Date(a.renewalDate) : null,
      })),
    )
    .onConflictDoNothing()
    .run();

  db.insert(requests)
    .values(
      SEED_REQUESTS.map((r) => ({
        id: requestIdFor(r.id),
        title: r.title,
        bodyRaw: r.bodyRaw,
        submitterKind: r.submitterKind,
        source: r.source,
        accountId: r.accountSlug ? accountIdFor(r.accountSlug) : null,
        createdAt: new Date(r.createdAt),
      })),
    )
    .onConflictDoNothing()
    .run();

  return { accounts: SEED_ACCOUNTS.length, requests: SEED_REQUESTS.length };
}
