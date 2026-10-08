'use server';

/**
 * Server Actions rather than an API layer, per
 * [ARCHITECTURE](../../docs/ARCHITECTURE.md#components).
 *
 * Each one is a shell: run the mutation, revalidate, then redirect back with a
 * short note the page turns into a sentence. Carrying feedback in the URL
 * rather than in a return value keeps the forms working with **no client
 * JavaScript**, which matters for a demo whose whole claim is that it runs from
 * a fresh clone with nothing configured.
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '../db/index';
import * as mutate from './mutations';

async function run(result: mutate.MutationResult, fallbackProblemId: string): Promise<never> {
  const problemId = result.problemId ?? fallbackProblemId;
  revalidatePath(`/problems/${problemId}`);
  revalidatePath('/problems');
  // redirect() throws, so it has to be last.
  redirect(`/problems/${problemId}?note=${encodeURIComponent(result.note)}`);
}

export async function addSupportAction(formData: FormData): Promise<void> {
  const problemId = String(formData.get('problemId') ?? '');
  const accountId = String(formData.get('accountId') ?? '');
  await run(mutate.addSupport(db, { problemId, accountId }), problemId);
}

export async function detachEvidenceAction(formData: FormData): Promise<void> {
  const linkId = String(formData.get('linkId') ?? '');
  const problemId = String(formData.get('problemId') ?? '');
  await run(mutate.detachEvidence(db, linkId), problemId);
}

export async function reattachEvidenceAction(formData: FormData): Promise<void> {
  const linkId = String(formData.get('linkId') ?? '');
  const problemId = String(formData.get('problemId') ?? '');
  await run(mutate.reattachEvidence(db, linkId), problemId);
}

/**
 * The review queue's two actions (E1).
 *
 * Same mutations as the detail page — rejecting a flagged attach *is*
 * `detachEvidence` — but they return to the queue instead of to the problem,
 * because a PM working a queue of eleven wants the twelfth, not a detour. The
 * queue is where the decision was made, so it is where the confirmation
 * belongs.
 */
async function backToReview(result: mutate.MutationResult): Promise<never> {
  revalidatePath('/review');
  revalidatePath('/problems');
  if (result.problemId) revalidatePath(`/problems/${result.problemId}`);
  redirect(`/review?note=${encodeURIComponent(result.note)}`);
}

export async function confirmFromReviewAction(formData: FormData): Promise<void> {
  await backToReview(mutate.confirmEvidence(db, String(formData.get('linkId') ?? '')));
}

export async function rejectFromReviewAction(formData: FormData): Promise<void> {
  await backToReview(mutate.detachEvidence(db, String(formData.get('linkId') ?? ''), 'review-queue'));
}
