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
