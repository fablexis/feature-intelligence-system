import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { accounts, evidenceLinks, problems, requests } from '@/db/schema';

/**
 * Minimal problem view: enough for C3's three outcomes to be inspectable.
 * C4 adds evidence strength, the support action and un-merge.
 */
/**
 * Blocking (not prerendered): this page reads live database state, so baking
 * it at build time would freeze the data. Next 16 prerenders by default with
 * Cache Components on, and the production build rejects uncached reads —
 * which is the correct complaint, caught by `next build` and not by `next dev`.
 */
export const instant = false;

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const problem = db.select().from(problems).where(eq(problems.id, id)).get();
  if (!problem) notFound();

  const evidence = db
    .select({
      requestId: requests.id,
      title: requests.title,
      bodyRaw: requests.bodyRaw,
      source: requests.source,
      accountName: accounts.name,
      segment: accounts.segment,
      needsReview: evidenceLinks.needsReview,
      confidence: evidenceLinks.confidence,
    })
    .from(evidenceLinks)
    .innerJoin(requests, eq(evidenceLinks.requestId, requests.id))
    .leftJoin(accounts, eq(requests.accountId, accounts.id))
    .where(and(eq(evidenceLinks.problemId, id), eq(evidenceLinks.active, true)))
    .all();

  const distinctAccounts = new Set(evidence.map((e) => e.accountName).filter(Boolean)).size;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">{problem.statement}</h1>
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Evidence</CardTitle>
          <CardDescription>
            {evidence.length} request{evidence.length === 1 ? '' : 's'} from {distinctAccounts}{' '}
            distinct account{distinctAccounts === 1 ? '' : 's'} · the original words are kept
            verbatim, never replaced by the abstraction
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {evidence.map((item) => (
            <div key={item.requestId} className="flex flex-col gap-1 border-b pb-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{item.title}</span>
                <Badge variant="outline">{item.source.replace('_', ' ')}</Badge>
                {item.accountName && (
                  <span className="text-muted-foreground text-xs">
                    {item.accountName} · {item.segment}
                  </span>
                )}
                {item.needsReview && <Badge variant="outline">needs review</Badge>}
              </div>
              {/* React escapes this by default — body_raw is untrusted. */}
              <p className="text-muted-foreground text-sm">{item.bodyRaw}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
