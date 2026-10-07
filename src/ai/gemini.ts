import { createGoogle } from '@ai-sdk/google';
import { embedMany, generateObject } from 'ai';
import { aiConfig, requireGeminiConfig } from './config';
import { fixtureKey, stableStringify } from './hash';
import { EMBED_PROMPT_VERSION, prompt } from './prompts';
import {
  AdjudicationSchema,
  type Factors,
  FactorsBatchSchema,
  FactorsSchema,
  ProblemDraftSchema,
  type Verdict,
  safeDistinct,
} from './schemas';
import type { AiProvider, AiResult, AdjudicateInput, EmbedInput, EmbedOutput, ExtractInput, FactorsInput, Stage } from './types';

/**
 * The real provider. Every non-embedding call goes through `generateObject`
 * with a Zod schema, so model output is parsed data and can never be executed
 * or treated as instruction (ARCHITECTURE: safety).
 *
 * Untrusted text is always placed inside a delimited block, never concatenated
 * into the instruction section of the prompt.
 */
function untrusted(label: string, body: string) {
  return `<${label}>\n${body}\n</${label}>`;
}

/**
 * The SDK retries internally (default 2, so 3 attempts per call). Left on, it
 * multiplies against the record script's own retry loop — up to 12 real API
 * calls for one logical call, which is how a 20/day free-tier cap was
 * exhausted by 7 extractions. Retrying is owned in exactly one place:
 * `scripts/record.ts`.
 */
const NO_SDK_RETRY = { maxRetries: 0 } as const;

const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const start = Date.now();
  const value = await fn();
  return [value, Date.now() - start];
};

export function createGeminiProvider(): AiProvider & {
  embedBatch(texts: string[]): Promise<Array<AiResult<EmbedOutput>>>;
  estimateFactorsBatch(
    inputs: Array<{ problemId: string; input: FactorsInput }>,
  ): Promise<Array<AiResult<Factors> & { problemId: string }>>;
} {
  const cfg = requireGeminiConfig();
  // The SDK reads GOOGLE_GENERATIVE_AI_API_KEY itself; we never touch the value.
  const google = createGoogle();

  const meta = (stage: Stage, modelId: string, promptVersion: string, input: unknown, latencyMs: number, tokens?: number) => ({
    provider: 'gemini' as const,
    modelId,
    promptVersion,
    inputHash: fixtureKey({ stage, modelId, promptVersion, input }),
    latencyMs,
    tokens,
    degraded: false,
  });

  async function embedBatch(texts: string[]): Promise<Array<AiResult<EmbedOutput>>> {
    const [res, latencyMs] = await timed(() =>
      embedMany({
        model: google.textEmbeddingModel(cfg.modelEmbed),
        ...NO_SDK_RETRY,
        values: texts,
        providerOptions: { google: { outputDimensionality: cfg.embedDim } },
      }),
    );
    const perText = Math.round(latencyMs / Math.max(texts.length, 1));
    return res.embeddings.map((vec, i) => ({
      value: { vector: Float32Array.from(vec), space: 'gemini' as const },
      meta: meta('embed', cfg.modelEmbed, EMBED_PROMPT_VERSION, texts[i], perText, res.usage?.tokens),
    }));
  }

  return {
    name: 'gemini',

    async extractProblem(input: ExtractInput) {
      const p = prompt.extract();
      const [res, latencyMs] = await timed(() =>
        generateObject({
          model: google(cfg.modelFast),
          ...NO_SDK_RETRY,
          schema: ProblemDraftSchema,
          system: p.text,
          prompt: [
            `source: ${input.source}`,
            untrusted('request_title', input.title),
            untrusted('request_body', input.bodyRaw),
          ].join('\n\n'),
        }),
      );
      return {
        value: res.object,
        meta: meta('extract', cfg.modelFast, p.version, input, latencyMs, res.usage?.totalTokens),
      };
    },

    async embed(input: EmbedInput) {
      const [one] = await embedBatch([input.text]);
      return one;
    },

    async adjudicate(input: AdjudicateInput): Promise<AiResult<Verdict[]>> {
      const p = prompt.adjudicate();
      const ids = input.candidates.map((c) => c.problemId);
      const [res, latencyMs] = await timed(() =>
        generateObject({
          model: google(cfg.modelAdjudicate),
          ...NO_SDK_RETRY,
          schema: AdjudicationSchema,
          system: p.text,
          prompt: [
            untrusted('new_problem', stableStringify(input.draft)),
            untrusted('candidates', stableStringify(input.candidates)),
          ].join('\n\n'),
        }),
      );
      // A model-supplied id that was not offered is discarded, not trusted.
      const known = new Set(ids);
      const verdicts = res.object.verdicts.filter((v) => known.has(v.problemId));
      const missing = ids.filter((id) => !verdicts.some((v) => v.problemId === id));
      return {
        value: [...verdicts, ...safeDistinct(missing, 'no verdict returned for this candidate')],
        meta: meta('adjudicate', cfg.modelAdjudicate, p.version, input, latencyMs, res.usage?.totalTokens),
      };
    },

    async estimateFactors(input: FactorsInput) {
      const p = prompt.factors();
      const [res, latencyMs] = await timed(() =>
        generateObject({
          model: google(cfg.modelScore),
          ...NO_SDK_RETRY,
          schema: FactorsSchema,
          system: p.text,
          prompt: [
            untrusted('problem', input.statement),
            untrusted('evidence', stableStringify(input.evidence)),
            untrusted('strategy', stableStringify(input.strategy)),
          ].join('\n\n'),
        }),
      );
      return {
        value: res.object,
        meta: meta('score', cfg.modelScore, p.version, input, latencyMs, res.usage?.totalTokens),
      };
    },

    embedBatch,
    estimateFactorsBatch,
  };

  /**
   * Factor estimates for several problems in one call — 4 per call, which cuts
   * the stage from 23 calls to 6 against a **measured 20/day cap** on this
   * model (ADR 0001 amendment). Quota is the scarce resource in this build.
   *
   * Batching is safe *here* and deliberately not safe for extraction. The eval
   * measures dedupe, and a model shown several requests at once could normalise
   * their statements toward each other, manufacturing the very similarity the
   * dedupe eval exists to measure. Nothing measures the scores, so cross-talk
   * between four problems in one prompt costs ranking nuance at worst — and for
   * a *ranking* task, seeing peers is arguably the right context.
   *
   * Two properties make it reproducible: batch composition is fixed by the
   * caller sorting on problem id, and each answer is keyed back to its problem
   * by id rather than by position, so a reordered response cannot silently
   * attribute one problem's factors to another. Any problem the model omits is
   * reported as missing rather than defaulted.
   */
  async function estimateFactorsBatch(
    inputs: Array<{ problemId: string; input: FactorsInput }>,
  ): Promise<Array<AiResult<Factors> & { problemId: string }>> {
    const p = prompt.factors();
    const [res, latencyMs] = await timed(() =>
      generateObject({
        model: google(cfg.modelScore),
        ...NO_SDK_RETRY,
        schema: FactorsBatchSchema,
        system: `${p.text}\n\n## This call covers several problems\n\nYou are given a list of problems. Return one estimate per problem, each tagged with the \`problemId\` it belongs to. Judge each problem on its own evidence; the others are context for relative ranking, not a reason to average.`,
        prompt: [
          untrusted(
            'problems',
            stableStringify(inputs.map((i) => ({ problemId: i.problemId, ...i.input }))),
          ),
        ].join('\n\n'),
      }),
    );

    const byId = new Map(res.object.estimates.map((e) => [e.problemId, e.factors]));
    const perProblem = Math.round(latencyMs / Math.max(inputs.length, 1));
    const tokens = res.usage?.totalTokens
      ? Math.round(res.usage.totalTokens / Math.max(inputs.length, 1))
      : undefined;

    return inputs.flatMap(({ problemId, input }) => {
      const factors = byId.get(problemId);
      if (!factors) return [];
      return [
        {
          problemId,
          value: factors,
          // Keyed on the SINGLE-problem input, which is what replay will look
          // up. The batch never appears in a fixture key.
          meta: meta('score', cfg.modelScore, p.version, input, perProblem, tokens),
        },
      ];
    });
  }
}

export const geminiEnabled = () => aiConfig().provider === 'gemini';
