import { and, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AppShell, EmptyState, Metric, Note, PageHeader } from '@/components/shell';
import { DegradedNotice, Flag, HumanChange, Provenance } from '@/components/signals';
import { db } from '@/db';
import { problems, requests } from '@/db/schema';
import { addSupportAction, detachEvidenceAction, reattachEvidenceAction } from '@/problems/actions';
import { allAccounts, evidenceFor, statsFor } from '@/problems/evidence';
import { provenanceForProblem } from '@/problems/provenance';

/**
 * A problem is legible as **accumulated evidence**, not as an abstraction.
 *
 * That is the whole design claim of this screen, and it is why the verbatim
 * request text sits next to the canonical statement rather than being replaced
 * by it (PRODUCT challenge #1): an extracted statement a submitter does not
 * recognise is a statement they will not trust, and the original words are the
 * only thing that can settle whether the grouping was right.
 *
 * E1 added the other half of that claim: beside each verbatim request, what the
 * adjudicator said about it and how sure it was, and beneath that what a human
 * changed afterwards. Acceptance property #2 is that every suggestion shows its
 * basis — a merge the PM cannot audit is one they should not accept — and until
 * this screen rendered the verdict, the basis was in the database and nowhere a
 * reviewer could see it.
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
  confirmed: 'Confirmed — the attach stands and the flag is cleared.',
  'already-confirmed': 'That attach was already confirmed.',
  'unknown-link': 'That evidence link no longer exists.',
  missing: 'Pick an account first.',
};

const SOURCE_LABEL: Record<string, string> = {
  csm_note: 'CSM note',
  ae_note: 'AE note',
  support_ticket: 'support ticket',
  internal: 'internal note',
  customer_direct: 'customer wrote in',
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
  const provenance = provenanceForProblem(db, id);
  // Which of these requests came through the n-gram fallback, so the label can
  // sit on the individual piece of evidence rather than on the whole problem.
  const degradedRequests = new Set(
    evidence.length === 0
      ? []
      : db
          .select({ id: requests.id })
          .from(requests)
          .where(
            and(
              eq(requests.degraded, true),
              inArray(
                requests.id,
                evidence.map((e) => e.requestId),
              ),
            ),
          )
          .all()
          .map((r) => r.id),
  );

  const renderEvidence = (item: (typeof evidence)[number], attached: boolean) => {
    const prov = provenance.get(item.linkId);
    return (
      <li key={item.linkId} className="flex flex-col gap-3 border-b py-4 last:border-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium">{item.title}</span>
          <span className="text-muted-foreground text-xs">
            {SOURCE_LABEL[item.source] ?? item.source.replace(/_/g, ' ')}
          </span>
          <span className="text-muted-foreground text-xs">
            {item.accountName ? `${item.accountName} · ${item.segment}` : 'internal · no account'}
          </span>
          {/* Only while attached: the flag means "a human owes this a look",
              and an un-merged link is one a human has already looked at. */}
          {item.needsReview && attached && <Flag>needs review</Flag>}
          {item.createdBy === 'human' && (
            <span className="text-muted-foreground text-xs">attached by a human</span>
          )}
        </div>

        {/* React escapes this by default — body_raw is untrusted. */}
        <p className="max-w-[70ch] text-sm leading-relaxed">{item.bodyRaw}</p>

        {degradedRequests.has(item.requestId) && <DegradedNotice where="this attach" />}

        {prov?.verdict && (
          <Provenance
            verdict={prov.verdict}
            confidence={prov.verdictConfidence}
            similarity={prov.similarity ?? item.confidence}
            rationale={prov.rationale}
          />
        )}
        {!prov?.verdict && item.createdBy === 'ai' && (
          <p className="text-muted-foreground text-xs">
            No adjudication on record — this request formed the problem rather than joining one, so
            there was nothing to compare it against.
          </p>
        )}

        {prov?.changes.map((change, i) => (
          <HumanChange
            key={i}
            field={change.field}
            from={change.from}
            to={change.to}
            reason={change.reason}
            actor={change.actor}
          />
        ))}

        <form action={attached ? detachEvidenceAction : reattachEvidenceAction}>
          <input type="hidden" name="linkId" value={item.linkId} />
          <input type="hidden" name="problemId" value={id} />
          <Button type="submit" variant={attached ? 'destructive' : 'outline'} size="sm">
            {attached ? 'Un-merge — this isn’t the same problem' : 'Re-attach'}
          </Button>
        </form>
      </li>
    );
  };

  return (
    <AppShell current="/problems" width="max-w-4xl">
      <div className="flex flex-col gap-6">
        <PageHeader
          title={problem.statement}
          metrics={
            <>
              <Metric
                label="distinct accounts"
                value={stats.strength}
                hint="never ARR-weighted"
              />
              <Metric label="attached requests" value={stats.requestCount} />
              {stats.needsReview > 0 && (
                <Metric label="flagged attaches" value={stats.needsReview} tone="flag" />
              )}
              {stats.detached > 0 && <Metric label="un-merged" value={stats.detached} />}
            </>
          }
        >
          <dl className="grid gap-1">
            <div>
              <dt className="text-foreground inline font-medium">Job to be done:</dt>{' '}
              <dd className="inline">{problem.jobToBeDone}</dd>
            </div>
            <div>
              <dt className="text-foreground inline font-medium">Workaround today:</dt>{' '}
              <dd className="inline">{problem.currentWorkaround}</dd>
            </div>
            <div>
              <dt className="text-foreground inline font-medium">Blocked outcome:</dt>{' '}
              <dd className="inline">{problem.blockedOutcome}</dd>
            </div>
          </dl>
        </PageHeader>

        {note && NOTES[note] && <Note>{NOTES[note]}</Note>}

        {stats.needsReview > 0 && (
          <p className="text-sm">
            {stats.needsReview} attach{stats.needsReview === 1 ? '' : 'es'} here landed below{' '}
            <code className="font-mono text-xs">T_auto</code> and still owe a human a look.{' '}
            <Link href="/review" className="font-medium underline underline-offset-4">
              Work the review queue
            </Link>
            .
          </p>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Evidence · {active.length} attached
          </h2>
          <p className="text-muted-foreground max-w-[60ch] text-xs">
            {stats.writeInAccounts} account{stats.writeInAccounts === 1 ? '' : 's'} wrote in,{' '}
            {stats.supportOnlyAccounts} clicked “this affects us too”. An account that did both
            counts once. Every request below is verbatim; the statement above indexes these, it
            never replaces them.
          </p>
        </div>

        {active.length === 0 ? (
          <EmptyState title="Nothing attached">
            Every piece of evidence here has been un-merged. The text is intact below and one click
            from being restored.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">{active.map((item) => renderEvidence(item, true))}</ul>
        )}

        {/* A plain form: one click, no client JavaScript. */}
        <form
          action={addSupportAction}
          className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3"
        >
          <input type="hidden" name="problemId" value={id} />
          <label htmlFor="accountId" className="text-sm font-medium">
            On behalf of
          </label>
          <select
            id="accountId"
            name="accountId"
            defaultValue={accounts[0]?.id}
            className="border-input bg-background focus-visible:ring-ring/50 h-9 rounded-md border px-2 text-sm focus-visible:ring-3 focus-visible:outline-none"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.segment})
              </option>
            ))}
          </select>
          <Button type="submit" size="lg">
            This affects us too
          </Button>
          <p className="text-muted-foreground text-xs">
            The vote attaches to the problem, never to a proposed solution. One click per account.
          </p>
        </form>
      </section>

      {detached.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-2">
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              Un-merged · {detached.length}
            </h2>
            <p className="text-muted-foreground max-w-[60ch] text-xs">
              Un-merging flips a flag; it never deletes. Shown because a reversal nobody can see is
              indistinguishable from a deletion.
            </p>
          </div>
          <ul className="flex flex-col opacity-80">
            {detached.map((item) => renderEvidence(item, false))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
