import { aiConfig } from './config';
import { type FixtureEntry, loadFixtures, loadManifest } from './fixtures';
import { fixtureKey } from './hash';
import { ngramEmbed } from './ngram';
import { EMBED_PROMPT_VERSION, prompt } from './prompts';
import {
  FactorsSchema,
  ProblemDraftSchema,
  type ProblemDraft,
  VerdictSchema,
  type Verdict,
  safeDistinct,
} from './schemas';
import type {
  AdjudicateInput,
  AiProvider,
  AiResult,
  EmbedInput,
  EmbedOutput,
  ExtractInput,
  FactorsInput,
  Stage,
} from './types';

/**
 * The keyless path: replays real recorded Gemini outputs, so a reviewer with
 * no API key sees genuine semantic matching rather than a string matcher
 * (ADR 0004).
 *
 * Unrecorded input degrades to n-grams and says so. It never pretends.
 */
export function createReplayProvider(fixtures = loadFixtures()): AiProvider {
  const cfg = aiConfig();
  const manifest = loadManifest();

  // Loud, once: the fixtures were recorded against specific models.
  if (manifest) {
    const drift = Object.entries({
      GEMINI_MODEL_FAST: [cfg.modelFast, manifest.models.fast],
      GEMINI_MODEL_EMBED: [cfg.modelEmbed, manifest.models.embed],
    }).filter(([, [env, rec]]) => env && rec && env !== rec);
    if (drift.length) {
      console.warn(
        `[replay] fixtures were recorded with different models; these will miss and degrade:\n${drift
          .map(([k, [env, rec]]) => `  ${k}: env=${env} recorded=${rec}`)
          .join('\n')}`,
      );
    }
  }

  const look = (stage: Stage, modelId: string, promptVersion: string, input: unknown) => {
    const key = fixtureKey({ stage, modelId, promptVersion, input });
    return { key, hit: fixtures.get(key) as FixtureEntry | undefined };
  };

  const meta = (modelId: string, promptVersion: string, key: string, degraded: boolean, tokens?: number) => ({
    provider: degraded ? ('ngram' as const) : ('replay' as const),
    modelId: degraded ? 'ngram-fallback' : modelId,
    promptVersion,
    inputHash: key,
    latencyMs: 0,
    tokens,
    degraded,
  });

  return {
    name: 'replay',

    async extractProblem(input: ExtractInput): Promise<AiResult<ProblemDraft>> {
      const p = prompt.extract();
      const { key, hit } = look('extract', cfg.modelFast, p.version, input);
      if (hit) {
        const parsed = ProblemDraftSchema.safeParse(hit.output);
        if (parsed.success) {
          return { value: parsed.data, meta: meta(cfg.modelFast, p.version, key, false, hit.tokens) };
        }
      }
      // Degraded: no model available, so the raw text stands in for the
      // extraction and confidence is 0 — which routes it to a human.
      return {
        value: {
          statement: `${input.title} — ${input.bodyRaw}`.slice(0, 300),
          jobToBeDone: 'unknown (no model available)',
          currentWorkaround: 'unknown (no model available)',
          blockedOutcome: 'unknown (no model available)',
          confidence: 0,
        },
        meta: meta(cfg.modelFast, p.version, key, true),
      };
    },

    async embed(input: EmbedInput): Promise<AiResult<EmbedOutput>> {
      const { key, hit } = look('embed', cfg.modelEmbed, EMBED_PROMPT_VERSION, input.text);
      if (hit && Array.isArray(hit.output)) {
        return {
          value: { vector: Float32Array.from(hit.output as number[]), space: 'gemini' },
          meta: meta(cfg.modelEmbed, EMBED_PROMPT_VERSION, key, false, hit.tokens),
        };
      }
      return {
        value: ngramEmbed(input.text, cfg.embedDim),
        meta: meta(cfg.modelEmbed, EMBED_PROMPT_VERSION, key, true),
      };
    },

    async adjudicate(input: AdjudicateInput): Promise<AiResult<Verdict[]>> {
      const p = prompt.adjudicate();
      const ids = input.candidates.map((c) => c.problemId);
      const { key, hit } = look('adjudicate', cfg.modelAdjudicate, p.version, input);
      if (hit) {
        const parsed = VerdictSchema.array().safeParse(hit.output);
        if (parsed.success) {
          const known = new Set(ids);
          const verdicts = parsed.data.filter((v) => known.has(v.problemId));
          const missing = ids.filter((id) => !verdicts.some((v) => v.problemId === id));
          return {
            value: [...verdicts, ...safeDistinct(missing, 'no recorded verdict for this candidate')],
            meta: meta(cfg.modelAdjudicate, p.version, key, false, hit.tokens),
          };
        }
      }
      // No adjudication without a model: never merge on a guess.
      return {
        value: safeDistinct(ids, 'unverified — no model available, so no merge was proposed'),
        meta: meta(cfg.modelAdjudicate, p.version, key, true),
      };
    },

    async estimateFactors(input: FactorsInput) {
      const p = prompt.factors();
      const { key, hit } = look('score', cfg.modelScore, p.version, input);
      if (hit) {
        const parsed = FactorsSchema.safeParse(hit.output);
        if (parsed.success) {
          return { value: parsed.data, meta: meta(cfg.modelScore, p.version, key, false, hit.tokens) };
        }
      }
      const unknown = { score: 0, citations: [], reason: 'no model available' };
      return {
        value: {
          customerValue: unknown,
          strategicFit: unknown,
          evidenceStrength: unknown,
          effort: unknown,
          confidence: 0,
          tension: '',
        },
        meta: meta(cfg.modelScore, p.version, key, true),
      };
    },
  };
}
