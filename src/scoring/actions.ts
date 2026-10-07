'use server';

/**
 * H4 — override a priority band, with a reason.
 *
 * The reason is **mandatory**, and that is the whole point of the screen rather
 * than a form-validation detail. PRODUCT challenge #4: a weighted sum whose
 * weights were invented in a meeting launders judgement into false
 * objectivity, and PM approval does not fix it, because a reviewer shown a
 * confident number rubber-stamps it. Approval is only real when disagreement is
 * cheap — so overriding is one click and a sentence, and the sentence is kept.
 *
 * The recorded reasons are the highest-value artifact the system produces: the
 * input to weight tuning (M3). A near-zero override rate would be a product
 * failure reported as a success.
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '../db/index';
import { humanOverrides } from '../db/schema';
import { BANDS, type Band } from './score';

const ACTOR = 'demo-reviewer';

export async function overrideBandAction(formData: FormData): Promise<void> {
  const problemId = String(formData.get('problemId') ?? '');
  const band = String(formData.get('band') ?? '');
  const suggested = String(formData.get('suggested') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  const note = (() => {
    if (!problemId || !BANDS.includes(band as Band)) return 'override-invalid';
    // Refused, not defaulted: an override without a reason is the thing this
    // feature exists to prevent.
    if (reason.length < 3) return 'override-needs-reason';
    if (band === suggested) return 'override-same-band';

    db.insert(humanOverrides)
      .values({
        targetType: 'problem_band',
        targetId: problemId,
        field: 'band',
        suggestedValue: suggested,
        finalValue: band,
        reason,
        actor: ACTOR,
      })
      .run();
    return 'override-recorded';
  })();

  revalidatePath('/priority');
  redirect(`/priority?note=${encodeURIComponent(note)}#${problemId}`);
}
