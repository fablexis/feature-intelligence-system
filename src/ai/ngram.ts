import { createHash } from 'node:crypto';
import type { EmbedOutput } from './types';

/**
 * Hashed character-trigram embedding — the fallback for input no fixture
 * covers.
 *
 * Be clear about what this is and is not. It is deterministic and offline, and
 * it will match near-identical wording. It **cannot** match a paraphrase with
 * disjoint vocabulary, which is the capability's own headline case. That is
 * why results from this path are flagged `degraded` and labelled in the UI
 * rather than presented as the real thing (ADR 0004).
 *
 * Its vectors are also not comparable with Gemini's — see `EmbeddingSpace`.
 */
export function ngramEmbed(text: string, dim: number): EmbedOutput {
  const vector = new Float32Array(dim);
  const padded = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

  for (let i = 0; i < padded.length - 2; i++) {
    const trigram = padded.slice(i, i + 3);
    // Two independent buckets per trigram reduces single-collision distortion.
    const digest = createHash('sha1').update(trigram).digest();
    for (const offset of [0, 4]) {
      const bucket = digest.readUInt32BE(offset) % dim;
      const sign = (digest[offset + 3] & 1) === 0 ? 1 : -1;
      vector[bucket] += sign;
    }
  }

  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vector[i] /= norm;

  return { vector, space: 'ngram' };
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
