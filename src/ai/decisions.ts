import type { Db } from '../db/index';
import { aiDecisions } from '../db/schema';
import type { AiProvider, AiResult, Stage } from './types';

/**
 * Decorates a provider so every model call writes exactly one `ai_decisions`
 * row. Kept as a wrapper rather than baked into the providers so the providers
 * stay testable without a database.
 */
export type DecisionSubject = { requestId?: string; problemId?: string };

export function withDecisionLog(
  provider: AiProvider,
  db: Db,
  subject: () => DecisionSubject = () => ({}),
): AiProvider {
  const log = <T>(stage: Stage, result: AiResult<T>, output: unknown) => {
    const { requestId, problemId } = subject();
    db.insert(aiDecisions)
      .values({
        stage,
        provider: result.meta.provider,
        modelId: result.meta.modelId,
        promptVersion: result.meta.promptVersion,
        inputHash: result.meta.inputHash,
        outputJson: output,
        confidence: confidenceOf(output),
        latencyMs: result.meta.latencyMs,
        tokens: result.meta.tokens ?? null,
        requestId: requestId ?? null,
        problemId: problemId ?? null,
      })
      .run();
    return result;
  };

  return {
    name: provider.name,
    extractProblem: async (i) => {
      const r = await provider.extractProblem(i);
      return log('extract', r, r.value);
    },
    embed: async (i) => {
      const r = await provider.embed(i);
      // The vector itself is not logged — it is large and uninformative here.
      return log('embed', r, { dim: r.value.vector.length, space: r.value.space });
    },
    adjudicate: async (i) => {
      const r = await provider.adjudicate(i);
      return log('adjudicate', r, r.value);
    },
    estimateFactors: async (i) => {
      const r = await provider.estimateFactors(i);
      return log('score', r, r.value);
    },
  };
}

function confidenceOf(output: unknown): number | null {
  if (output && typeof output === 'object' && 'confidence' in output) {
    const c = (output as { confidence: unknown }).confidence;
    if (typeof c === 'number') return c;
  }
  return null;
}
