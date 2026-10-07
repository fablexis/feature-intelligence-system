import { APICallError } from 'ai';

/**
 * Rate-limit classification.
 *
 * The distinction that matters is not "is this a 429" but **how long until it
 * clears**. A per-minute rate limit clears in seconds and should be waited
 * out. A daily quota cap reports a retry delay measured in hours, and
 * backing off against it just burns wall-clock before failing anyway.
 *
 * Learned the hard way: Gemini's free tier caps `generate_content` at 20
 * requests per DAY per model, and the error arrives as a 429 indistinguishable
 * at a glance from a transient one. Retrying it is pointless; switching model
 * or waiting is the only recourse.
 */
export type Classified =
  | { kind: 'retryable'; status: number; waitMs?: number }
  | { kind: 'exhausted'; status: number; retryAfterSec: number; limit?: number; model?: string }
  | { kind: 'fatal'; status: number };

/** Longest delay worth sleeping through inside a record run. */
export const MAX_WAIT_MS = 120_000;

export function statusOf(err: unknown): number {
  if (APICallError.isInstance(err) && typeof err.statusCode === 'number') return err.statusCode;
  if (err && typeof err === 'object') {
    for (const key of ['statusCode', 'status']) {
      const v = (err as Record<string, unknown>)[key];
      if (typeof v === 'number') return v;
    }
    const cause = (err as { cause?: unknown }).cause;
    if (cause && cause !== err) return statusOf(cause);
  }
  return 0;
}

/** Parses Google's "Please retry in 19h21m10.9s" and RetryInfo-style delays. */
export function retryAfterSeconds(message: string): number | undefined {
  const duration = message.match(/retry in\s+([\d.]+h)?([\d.]+m)?([\d.]+s)?/i);
  if (duration && (duration[1] || duration[2] || duration[3])) {
    const num = (part?: string) => (part ? Number.parseFloat(part) : 0);
    return num(duration[1]) * 3600 + num(duration[2]) * 60 + num(duration[3]);
  }
  const seconds = message.match(/retryDelay"?\s*[:=]\s*"?([\d.]+)s/i);
  return seconds ? Number.parseFloat(seconds[1]) : undefined;
}

export function classify(err: unknown): Classified {
  const status = statusOf(err);
  const message = err instanceof Error ? err.message : String(err);
  const retryAfterSec = retryAfterSeconds(message);
  const quota = /exceeded your current quota|RESOURCE_EXHAUSTED|free_tier/i.test(message);

  if (quota && (retryAfterSec === undefined || retryAfterSec * 1000 > MAX_WAIT_MS)) {
    return {
      kind: 'exhausted',
      status: status || 429,
      retryAfterSec: retryAfterSec ?? Number.POSITIVE_INFINITY,
      limit: Number(message.match(/limit:\s*(\d+)/)?.[1]) || undefined,
      model: message.match(/model:\s*([\w.-]+)/)?.[1],
    };
  }
  if (status === 429 || (status >= 500 && status < 600)) {
    return { kind: 'retryable', status, waitMs: retryAfterSec ? retryAfterSec * 1000 : undefined };
  }
  // A genuine transport failure has no status at all.
  if (status === 0 && !quota) return { kind: 'retryable', status: 0 };
  return { kind: 'fatal', status };
}

export function describeExhausted(c: Extract<Classified, { kind: 'exhausted' }>): string {
  const hours = Number.isFinite(c.retryAfterSec) ? (c.retryAfterSec / 3600).toFixed(1) : '?';
  return [
    `quota exhausted for ${c.model ?? 'this model'}`,
    c.limit ? `(daily limit: ${c.limit})` : '',
    `— clears in ~${hours}h.`,
    'Retrying cannot help. Switch GEMINI_MODEL_FAST to a model with its own',
    'quota bucket, or wait. Progress is checkpointed; a re-run resumes.',
  ]
    .filter(Boolean)
    .join(' ');
}
