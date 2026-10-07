import type { ProblemDraft } from './schemas';

/**
 * The exact string that gets embedded for a problem.
 *
 * Shared by the record script and the pipeline on purpose: if these two ever
 * canonicalised differently, every recorded embedding would miss its fixture
 * and the whole demo would silently fall back to n-grams.
 */
export function canonicalText(
  draft: Pick<ProblemDraft, 'statement' | 'jobToBeDone' | 'currentWorkaround' | 'blockedOutcome'>,
): string {
  return [draft.statement, draft.jobToBeDone, draft.currentWorkaround, draft.blockedOutcome].join(' | ');
}
