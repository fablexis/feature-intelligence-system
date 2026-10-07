import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { classify, retryAfterSeconds, statusOf } from './errors';

/** The real message Gemini returns when the free-tier daily cap is hit. */
const DAILY_CAP =
  'You exceeded your current quota, please check your plan and billing details. ' +
  '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
  'limit: 20, model: gemini-3.8-flash Please retry in 19h21m10.92605059s.';

const apiError = (status: number, message: string) =>
  new APICallError({ message, url: 'https://example.invalid', requestBodyValues: {}, statusCode: status });

describe('retryAfterSeconds', () => {
  it('parses hours, minutes and fractional seconds', () => {
    expect(retryAfterSeconds(DAILY_CAP)).toBeCloseTo(19 * 3600 + 21 * 60 + 10.926, 1);
  });

  it('parses a short retryDelay', () => {
    expect(retryAfterSeconds('rate limited, retryDelay: 7s')).toBe(7);
  });

  it('returns undefined when no delay is stated', () => {
    expect(retryAfterSeconds('something went wrong')).toBeUndefined();
  });
});

describe('classify', () => {
  it('treats an exhausted daily quota as NOT retryable', () => {
    const c = classify(apiError(429, DAILY_CAP));
    expect(c.kind).toBe('exhausted');
    if (c.kind !== 'exhausted') return;
    expect(c.limit).toBe(20);
    expect(c.model).toBe('gemini-3.8-flash');
    expect(c.retryAfterSec).toBeGreaterThan(60_000);
  });

  it('treats a short-delay 429 as retryable', () => {
    const c = classify(apiError(429, 'Too many requests. Please retry in 5s.'));
    expect(c.kind).toBe('retryable');
    if (c.kind !== 'retryable') return;
    expect(c.waitMs).toBe(5000);
  });

  it('treats 5xx as retryable', () => {
    expect(classify(apiError(503, 'The model is overloaded.')).kind).toBe('retryable');
  });

  it('treats a transport failure with no status as retryable', () => {
    expect(classify(new Error('socket hang up')).kind).toBe('retryable');
  });

  it('treats a 4xx that is not a rate limit as fatal, so it fails fast', () => {
    expect(classify(apiError(400, 'Invalid argument')).kind).toBe('fatal');
    expect(classify(apiError(401, 'Unauthenticated')).kind).toBe('fatal');
  });
});

describe('statusOf', () => {
  it('reads the status from an AI SDK error', () => {
    expect(statusOf(apiError(429, 'x'))).toBe(429);
  });

  it('reads a nested cause', () => {
    const outer = new Error('wrapper');
    (outer as Error & { cause?: unknown }).cause = { statusCode: 503 };
    expect(statusOf(outer)).toBe(503);
  });

  it('returns 0 for a plain error rather than guessing', () => {
    expect(statusOf(new Error('nope'))).toBe(0);
  });
});
