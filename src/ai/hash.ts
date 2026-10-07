import { createHash } from 'node:crypto';
import type { Stage } from './types';

/** Collapse whitespace and case so trivial formatting differences share a key. */
export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Fixture key. Includes the model id and prompt version deliberately: when
 * either changes, every key changes, so stale fixtures miss loudly instead of
 * silently replaying outputs produced by a prompt that no longer exists
 * (ADR 0004).
 */
export function fixtureKey(args: {
  stage: Stage;
  modelId: string;
  promptVersion: string;
  input: unknown;
}): string {
  const payload = [
    args.stage,
    args.modelId,
    args.promptVersion,
    normalize(typeof args.input === 'string' ? args.input : stableStringify(args.input)),
  ].join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

/** Key order must not change the hash. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
