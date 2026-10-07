import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { problems } from '@/db/schema';
import { addSupportAction, detachEvidenceAction, reattachEvidenceAction } from '@/problems/actions';
import { allAccounts, evidenceFor, statsFor } from '@/problems/evidence';

/**
 * A problem is legible as **accumulated evidence**, not as an abstraction.
 *
 * That is the whole design claim of this screen, and it is why the verbatim
 * request text sits next to the canonical statement rather than being replaced
 * by it (PRODUCT challenge #1): an extracted statement a submitter does not
 * recognise is a statement they will not trust, and the original words are the
 * only thing that can settle whether the grouping was right.
 */

/**
 * Blocking (not prerendered): this page reads live database state, so baking
 * it at build time would freeze the data. Next 16 prerenders by default with
 * Cache Components on, and the production build rejects uncached reads —
 * which is the correct complaint, caught by `next build` and not by `next dev`.
 */
export const instant = false;

/** Short, stable keys from the Server Actions, turned into sentences here. */
const NOTES: Record<string, string> = {
  'support-added': 'Recorded — this account is now counted in evidence strength.',
  'support-duplicate': 'Already recorded for that account. One click per account, by design.',
  detached: 'Un-merged. The request is intact below and can be re-attached.',
  'already-detached': 'That evidence was already detached.',
  reattached: 'Re-attached.',
  'already-attached': 'That evidence was already attached.',
  'unknown-link': 'That evidence link no longer exists.',
  missing: 'Pick an account first.',
};

export default async function ProblemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ note?: string }>;
}) {
  const { id } = await params;
  const { note } = await searchParams;
  const problem = db.select().from(problems).where(eq(problems.id, id)).get();
  if (!problem) notFound();

  const stats = statsFor(db, id);
  const evidence = evidenceFor(db, id);
  const active = evidence.filter((e) => e.active);
  const detached = evidence.filter((e) => !e.active);
  const accounts = allAccounts(db);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div>
        <Link href="/problems" className="text-muted-foreground text-sm hover:underline">
          ← All problems
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">{problem.statement}</h1>
        <dl className="text-muted-foreground mt-3 grid gap-1 text-sm">
          <div>
            <span className="font-medium">Job to be done:</span> {problem.jobToBeDone}
          </div>
          <div>
            <span className="font-medium">Workaround today:</span> {problem.currentWorkaround}
          </div>
          <div>
            <span className="font-medium">Blocked outcome:</span> {problem.blockedOutcome}
          </div>
        </dl>
      </div>

      {note && NOTES[note] && (
        <p className="bg-muted rounded-md px-3 py-2 text-sm" role="status">
          {NOTES[note]}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Evidence strength: {stats.strength} account{stats.strength === 1 ? '' : 's'}
          </CardTitle>
          <CardDescription>
            A raw count of distinct accounts affected, never ARR-weighted — ARR reaches the ranking
            through <code>customer_value</code> alone, so the same signal is not counted twice.{' '}
            {stats.writeInAccounts} wrote in, {stats.supportOnlyAccounts} clicked “this affects us
            too”. An account that did both counts once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* A plain form: one click, no client JavaScript. */}
          <form action={addSupportAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="problemId" value={id} />
            <label htmlFor="accountId" className="text-sm">
              On behalf of
            </label>
            <select
              id="accountId"
              name="accountId"
              defaultValue={accounts[0]?.id}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.segment})
                </option>
              ))}
            </select>
            <Button type="submit" size="sm">
              This affects us too
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {active.length} attached request{active.length === 1 ? '' : 's'}
          </CardTitle>
          <CardDescription>
            Every one in the submitter’s own words, stored verbatim and rendered escaped. The
            canonical statement above indexes these; it never replaces them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {active.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nothing attached. Every piece of evidence here has been un-merged — see below.
            </p>
          )}
          {active.map((item) => (
            <div key={item.linkId} className="flex flex-col gap-1 border-b pb-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{item.title}</span>
                <Badge variant="outline">{item.source.replace(/_/g, ' ')}</Badge>
                <span className="text-muted-foreground text-xs">
                  {item.accountName ? `${item.accountName} · ${item.segment}` : 'internal · no account'}
                </span>
                {item.needsReview && <Badge variant="outline">needs review</Badge>}
                {item.createdBy === 'human' && <Badge variant="outline">attached by a human</Badge>}
              </div>
              {/* React escapes this by default — body_raw is untrusted. */}
              <p className="text-muted-foreground text-sm">{item.bodyRaw}</p>
              <form action={detachEvidenceAction}>
                <input type="hidden" name="linkId" value={item.linkId} />
                <input type="hidden" name="problemId" value={id} />
                <Button type="submit" variant="outline" size="sm">
                  Un-merge — this isn’t the same problem
                </Button>
              </form>
            </div>
          ))}
        </CardContent>
      </Card>

      {detached.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {detached.length} detached request{detached.length === 1 ? '' : 's'}
            </CardTitle>
            <CardDescription>
              Un-merging flips a flag; it never deletes. These are shown because a reversal nobody
              can see is indistinguishable from a deletion — the text is intact and one click from
              being re-attached.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {detached.map((item) => (
              <div key={item.linkId} className="flex flex-col gap-1 border-b pb-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{item.title}</span>
                  <Badge variant="outline">{item.source.replace(/_/g, ' ')}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {item.accountName
                      ? `${item.accountName} · ${item.segment}`
                      : 'internal · no account'}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">{item.bodyRaw}</p>
                <form action={reattachEvidenceAction}>
                  <input type="hidden" name="linkId" value={item.linkId} />
                  <input type="hidden" name="problemId" value={id} />
                  <Button type="submit" variant="outline" size="sm">
                    Re-attach
                  </Button>
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
