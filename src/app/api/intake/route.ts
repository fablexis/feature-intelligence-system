import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAiProvider, withDecisionLog } from '@/ai';
import { db } from '@/db';
import { problems, requests } from '@/db/schema';
import { type StageEvent, ingestRequest } from '@/pipeline/ingest';

/**
 * Streams the intake pipeline stage by stage as NDJSON.
 *
 * A single spinner over a ~7s pipeline reads as a hang, and the submitter has
 * roughly 60 seconds of attention (PRODUCT: usage scene). So each stage is
 * flushed as it completes rather than buffered to the end.
 */
const Body = z.object({
  title: z.string().min(3).max(200),
  bodyRaw: z.string().min(3).max(4000),
  source: z.enum(['csm_note', 'ae_note', 'support_ticket', 'internal', 'customer_direct']),
  submitterKind: z.enum(['customer', 'prospect', 'support', 'internal']),
  accountId: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'invalid request' }, { status: 400 });
  }
  const input = parsed.data;
  const thresholds = JSON.parse(readFileSync('./config/thresholds.json', 'utf8'));

  const requestId = `req-live-${Date.now().toString(36)}`;
  db.insert(requests)
    .values({
      id: requestId,
      title: input.title,
      bodyRaw: input.bodyRaw,
      submitterKind: input.submitterKind,
      source: input.source,
      accountId: input.accountId ?? null,
    })
    .run();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const provider = withDecisionLog(createAiProvider(), db, () => ({ requestId }));
        const result = await ingestRequest(
          db,
          provider,
          { id: requestId, title: input.title, bodyRaw: input.bodyRaw, source: input.source },
          {
            tAuto: Number(thresholds.tAuto),
            candidateLimit: thresholds.candidateLimit === 'all' ? 'all' : Number(thresholds.candidateLimit),
            minSimilarity: Number(thresholds.minSimilarity ?? 0),
            onStage: (event: StageEvent) => send({ type: 'stage', ...event }),
          },
        );

        const attachedTo =
          result.resolution.kind === 'attach'
            ? db.select().from(problems).where(eq(problems.id, result.resolution.problemId)).get()
            : db.select().from(problems).where(eq(problems.id, `prob-${requestId}`)).get();

        send({
          type: 'done',
          requestId,
          degraded: result.degraded,
          candidateCount: result.candidates.length,
          resolution:
            result.resolution.kind === 'attach'
              ? {
                  kind: 'attach',
                  auto: result.resolution.auto,
                  score: result.resolution.score,
                  rationale: result.resolution.verdict.rationale,
                  problemId: result.resolution.problemId,
                }
              : { kind: 'create', problemId: `prob-${requestId}` },
          problem: attachedTo
            ? {
                id: attachedTo.id,
                statement: attachedTo.statement,
                currentWorkaround: attachedTo.currentWorkaround,
              }
            : null,
        });
      } catch (err) {
        // Message only; an SDK error can carry request details.
        send({ type: 'error', message: err instanceof Error ? err.message : 'pipeline failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
}
