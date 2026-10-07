import type { EmbeddingSpace } from '../ai/types';

/**
 * Float32Array ↔ BLOB, for the embeddings stored on `problems`
 * ([ADR 0003](../../docs/adr/0003-brute-force-cosine.md)).
 *
 * Little-endian is written explicitly rather than relying on the host, so a
 * database file stays readable if it ever moves between machines.
 */
export function encodeVector(vector: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i++) buf.writeFloatLE(vector[i], i * 4);
  return buf;
}

export function decodeVector(buf: Buffer | Uint8Array): Float32Array {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length % 4 !== 0) throw new Error(`vector blob length ${b.length} is not a multiple of 4`);
  const out = new Float32Array(b.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
  return out;
}

/**
 * The embedding model id doubles as the space tag on persisted problems.
 * Anything produced by the n-gram fallback is tagged so it can never be
 * mistaken for a real vector.
 */
export const NGRAM_MODEL_ID = 'ngram-fallback';

export const spaceOf = (embeddingModel: string | null): EmbeddingSpace =>
  embeddingModel === NGRAM_MODEL_ID ? 'ngram' : 'gemini';

export const modelIdFor = (space: EmbeddingSpace, modelId: string) =>
  space === 'ngram' ? NGRAM_MODEL_ID : modelId;
