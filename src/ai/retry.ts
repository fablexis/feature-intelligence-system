import { MAX_WAIT_MS, classify, describeExhausted } from './errors';

export class QuotaExhausted extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries transient failures; **refuses to retry an exhausted daily quota**,
 * whose retry-after is measured in hours so backing off against it only burns
 * wall-clock before failing anyway (ADR 0001 amendment).
 *
 * Shared by every script that spends quota, so the policy cannot drift between
 * them — and so no script accidentally stacks a second retry layer on top of
 * the SDK's, which is what exhausted a day's budget on 7 calls.
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempt = 1,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const c = classify(err);
    if (c.kind === 'exhausted') throw new QuotaExhausted(describeExhausted(c));
    if (c.kind === 'fatal' || attempt >= 5) throw err;
    const backoff = Math.min(c.waitMs ?? 2 ** attempt * 1000, MAX_WAIT_MS) + Math.random() * 500;
    console.warn(
      `  ${label}: ${c.status || 'transport'} — retry ${attempt}/4 in ${Math.round(backoff)}ms`,
    );
    await sleep(backoff);
    return withRetry(label, fn, attempt + 1);
  }
}

export { sleep };
