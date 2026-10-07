import { z } from 'zod';

/**
 * Every non-embedding model call is validated against one of these. Free text
 * never becomes control flow: an output that fails the schema is discarded and
 * the caller falls back to its safe default.
 */

export const ProblemDraftSchema = z.object({
  statement: z.string().min(10).max(300),
  jobToBeDone: z.string().min(5).max(300),
  currentWorkaround: z.string().min(5).max(300),
  blockedOutcome: z.string().min(5).max(300),
  confidence: z.number().min(0).max(1),
});
export type ProblemDraft = z.infer<typeof ProblemDraftSchema>;

export const RELATIONS = ['same', 'related', 'distinct'] as const;
export type Relation = (typeof RELATIONS)[number];

export const VerdictSchema = z.object({
  problemId: z.string().min(1),
  relation: z.enum(RELATIONS),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(400),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const AdjudicationSchema = z.object({ verdicts: z.array(VerdictSchema) });

const FactorSchema = z.object({
  score: z.number().min(0).max(1),
  citations: z.array(z.string()),
  reason: z.string().min(1).max(400),
});

export const FactorsSchema = z.object({
  customerValue: FactorSchema,
  strategicFit: FactorSchema,
  evidenceStrength: FactorSchema,
  effort: FactorSchema,
  confidence: z.number().min(0).max(1),
  tension: z.string().max(400).default(''),
});
export type Factors = z.infer<typeof FactorsSchema>;

/**
 * One batched factor call covers several problems, each answer keyed by problem
 * id so the results cannot be silently reordered or misattributed.
 *
 * Fixtures stay keyed **per problem**, so batching is an implementation detail
 * of recording and is invisible to replay — adding a 13th problem does not
 * invalidate the other twelve.
 */
export const FactorsBatchSchema = z.object({
  estimates: z.array(z.object({ problemId: z.string().min(1), factors: FactorsSchema })),
});

/**
 * The safe default for adjudication. Per ADR 0002 and the error asymmetry in
 * PRODUCT challenge #3, anything unexpected — schema violation, unknown enum,
 * missing candidate, provider failure — resolves to `distinct`, which is the
 * non-destructive outcome.
 */
export function safeDistinct(problemIds: string[], reason: string): Verdict[] {
  return problemIds.map((problemId) => ({
    problemId,
    relation: 'distinct' as const,
    confidence: 0,
    rationale: reason,
  }));
}
