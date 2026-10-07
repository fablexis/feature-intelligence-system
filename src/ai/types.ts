import type { Factors, ProblemDraft, Verdict } from './schemas';

export type Stage = 'extract' | 'embed' | 'adjudicate' | 'score';
export type ProviderName = 'gemini' | 'replay' | 'ngram';

/**
 * Which vector space an embedding lives in.
 *
 * This is not bookkeeping. Gemini vectors and n-gram vectors are not
 * comparable: cosine between them is **garbage, not merely worse**, because
 * they share no geometry. So every vector carries its space, problems persist
 * `embedding_model`, and retrieval (C3) must only compare within one space.
 */
export type EmbeddingSpace = 'gemini' | 'ngram';

export type AiMeta = {
  provider: ProviderName;
  modelId: string;
  promptVersion: string;
  inputHash: string;
  latencyMs: number;
  tokens?: number;
  /** True when this result came from the n-gram fallback, not a real model. */
  degraded: boolean;
};

export type AiResult<T> = { value: T; meta: AiMeta };

export type ExtractInput = {
  title: string;
  bodyRaw: string;
  source: 'csm_note' | 'ae_note' | 'support_ticket' | 'internal' | 'customer_direct';
};

export type EmbedInput = { text: string };

export type EmbedOutput = { vector: Float32Array; space: EmbeddingSpace };

export type Candidate = { problemId: string; statement: string; currentWorkaround: string };

export type AdjudicateInput = { draft: ProblemDraft; candidates: Candidate[] };

export type FactorsInput = {
  statement: string;
  evidence: Array<{ id: string; text: string; accountName?: string; segment?: string; arrUsd?: number }>;
  strategy: unknown;
};

export interface AiProvider {
  readonly name: ProviderName;
  extractProblem(input: ExtractInput): Promise<AiResult<ProblemDraft>>;
  embed(input: EmbedInput): Promise<AiResult<EmbedOutput>>;
  adjudicate(input: AdjudicateInput): Promise<AiResult<Verdict[]>>;
  estimateFactors(input: FactorsInput): Promise<AiResult<Factors>>;
}
