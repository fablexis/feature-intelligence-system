/**
 * Data model — see docs/ARCHITECTURE.md#data-model
 *
 * Append-only tables (ai_decisions, dedupe_suggestions, human_overrides,
 * score_runs) are never updated in place. History is the product: rejected
 * suggestions power M1, and retained suggested-vs-final values power M3.
 */
import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = () => new Date();
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now);

/** Customer accounts. Supplies the customer-value context for scoring. */
export const accounts = sqliteTable('accounts', {
  id: id(),
  name: text('name').notNull(),
  segment: text('segment', { enum: ['enterprise', 'mid', 'smb'] }).notNull(),
  arrCents: integer('arr_cents').notNull().default(0),
  renewalDate: integer('renewal_date', { mode: 'timestamp' }),
  createdAt: createdAt(),
});

/**
 * Raw inbound feature requests. `bodyRaw` is immutable and verbatim — the
 * extracted problem indexes it, never replaces it (PRODUCT challenge #1).
 */
export const requests = sqliteTable(
  'requests',
  {
    id: id(),
    title: text('title').notNull(),
    bodyRaw: text('body_raw').notNull(),
    submitterKind: text('submitter_kind', {
      enum: ['customer', 'prospect', 'support', 'internal'],
    }).notNull(),
    /**
     * Intake channel. Distinct from `submitterKind`: a CSM's third-person note
     * about a customer and that customer's own first-person words are both
     * `customer`, but they read very differently and the extractor must cope
     * with each. Kept so prompts can say whose voice the text is in.
     */
    source: text('source', {
      enum: ['csm_note', 'ae_note', 'support_ticket', 'internal', 'customer_direct'],
    }).notNull(),
    accountId: text('account_id').references(() => accounts.id),
    resolution: text('resolution', {
      enum: ['attached', 'related', 'created'],
    }),
    degraded: integer('degraded', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    triagedAt: integer('triaged_at', { mode: 'timestamp' }),
  },
  (t) => [index('requests_account_idx').on(t.accountId)],
);

/**
 * Canonical problems. The extraction schema is deliberately rigid:
 * `currentWorkaround` is the anchor that resists over-abstraction
 * (PRODUCT challenge #2).
 */
export const problems = sqliteTable(
  'problems',
  {
    id: id(),
    statement: text('statement').notNull(),
    jobToBeDone: text('job_to_be_done').notNull(),
    currentWorkaround: text('current_workaround').notNull(),
    blockedOutcome: text('blocked_outcome').notNull(),
    /** Float32Array serialised as a BLOB — see docs/adr/0003. */
    embedding: blob('embedding', { mode: 'buffer' }),
    embeddingModel: text('embedding_model'),
    /** Non-null once merged into another problem. Makes merges reversible. */
    mergedIntoId: text('merged_into_id'),
    createdAt: createdAt(),
  },
  (t) => [index('problems_merged_into_idx').on(t.mergedIntoId)],
);

/**
 * Request → problem attachment. The unit of reversibility: un-merging flips
 * `active`; nothing is ever deleted.
 */
export const evidenceLinks = sqliteTable(
  'evidence_links',
  {
    id: id(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id),
    problemId: text('problem_id')
      .notNull()
      .references(() => problems.id),
    createdBy: text('created_by', { enum: ['ai', 'human'] }).notNull(),
    confidence: real('confidence'),
    suggestionId: text('suggestion_id'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    /**
     * Attached, but below `T_auto` — so a PM still has to confirm it. Stored
     * rather than derived from `confidence < T_auto`, because T_auto changes
     * when the eval re-runs and history must not change with it.
     */
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('evidence_problem_idx').on(t.problemId, t.active),
    index('evidence_request_idx').on(t.requestId),
  ],
);

/** "Same problem, different scope/segment" — information a binary merge destroys. */
export const problemLinks = sqliteTable(
  'problem_links',
  {
    id: id(),
    problemAId: text('problem_a_id')
      .notNull()
      .references(() => problems.id),
    problemBId: text('problem_b_id')
      .notNull()
      .references(() => problems.id),
    kind: text('kind', { enum: ['related'] })
      .notNull()
      .default('related'),
    createdBy: text('created_by', { enum: ['ai', 'human'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('problem_links_pair_idx').on(t.problemAId, t.problemBId)],
);

/** The re-pointed vote: one click, attached to a problem, not a solution. */
export const supports = sqliteTable(
  'supports',
  {
    id: id(),
    problemId: text('problem_id')
      .notNull()
      .references(() => problems.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    actor: text('actor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('supports_problem_account_idx').on(t.problemId, t.accountId)],
);

/**
 * Audit log for every model call, including which prompt version produced it.
 * Makes any AI output traceable after the fact.
 */
export const aiDecisions = sqliteTable(
  'ai_decisions',
  {
    id: id(),
    stage: text('stage', {
      enum: ['extract', 'embed', 'adjudicate', 'score'],
    }).notNull(),
    provider: text('provider', { enum: ['gemini', 'replay', 'ngram'] }).notNull(),
    modelId: text('model_id').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputHash: text('input_hash').notNull(),
    outputJson: text('output_json', { mode: 'json' }).notNull(),
    confidence: real('confidence'),
    latencyMs: integer('latency_ms').notNull(),
    tokens: integer('tokens'),
    /** Subject of the call, for "which calls produced this?" queries. */
    requestId: text('request_id').references(() => requests.id),
    problemId: text('problem_id').references(() => problems.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_decisions_stage_idx').on(t.stage, t.createdAt),
    index('ai_decisions_request_idx').on(t.requestId),
  ],
);

/**
 * Every dedupe candidate shown, **including rejected ones** — that retention is
 * what makes M1's counterfactual computable without a separate experiment.
 */
export const dedupeSuggestions = sqliteTable(
  'dedupe_suggestions',
  {
    id: id(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id),
    candidateProblemId: text('candidate_problem_id')
      .notNull()
      .references(() => problems.id),
    similarity: real('similarity').notNull(),
    verdict: text('verdict', { enum: ['same', 'related', 'distinct'] }).notNull(),
    verdictConfidence: real('verdict_confidence'),
    rationale: text('rationale'),
    humanAction: text('human_action', {
      enum: ['auto', 'accepted', 'related', 'rejected', 'unsure'],
    }),
    shownAt: createdAt(),
    actedAt: integer('acted_at', { mode: 'timestamp' }),
  },
  (t) => [index('dedupe_request_idx').on(t.requestId)],
);

/** Append-only. Suggested and final are both retained forever (M3). */
export const humanOverrides = sqliteTable(
  'human_overrides',
  {
    id: id(),
    targetType: text('target_type', {
      enum: ['problem_band', 'problem_factor', 'merge', 'statement'],
    }).notNull(),
    targetId: text('target_id').notNull(),
    field: text('field').notNull(),
    suggestedValue: text('suggested_value'),
    finalValue: text('final_value'),
    reason: text('reason'),
    actor: text('actor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('overrides_target_idx').on(t.targetType, t.targetId)],
);

/** Append-only. A re-score adds a row; it never overwrites one. */
export const scoreRuns = sqliteTable(
  'score_runs',
  {
    id: id(),
    problemId: text('problem_id')
      .notNull()
      .references(() => problems.id),
    weightsVersion: text('weights_version').notNull(),
    /** Factor estimates plus the evidence ids each one cites. */
    factorsJson: text('factors_json', { mode: 'json' }).notNull(),
    rawScore: real('raw_score').notNull(),
    band: text('band', { enum: ['now', 'next', 'later', 'no'] }).notNull(),
    confidence: real('confidence'),
    modelId: text('model_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('score_runs_problem_idx').on(t.problemId, t.createdAt)],
);

export const schema = {
  accounts,
  requests,
  problems,
  evidenceLinks,
  problemLinks,
  supports,
  aiDecisions,
  dedupeSuggestions,
  humanOverrides,
  scoreRuns,
};

/** Table names in SQLite, for migration and eval assertions. */
export const TABLE_NAMES = [
  'accounts',
  'requests',
  'problems',
  'evidence_links',
  'problem_links',
  'supports',
  'ai_decisions',
  'dedupe_suggestions',
  'human_overrides',
  'score_runs',
] as const;

export { sql };
