/**
 * All model identity comes from the environment (ADR 0001). Nothing in src/
 * may contain a literal model id — C2's acceptance criteria check that with
 * grep, and a test checks it too.
 *
 * When the environment is silent, the ids come from the committed
 * `.env.example` template, which [ARCHITECTURE](../../docs/ARCHITECTURE.md)
 * already names as the one place model ids live. That fallback is not a
 * convenience: a fixture key includes the model id (`src/ai/hash.ts`), so on
 * the replay path the **correct** id is the one the fixtures were recorded
 * with. Without it, a fresh clone with no `.env` misses every fixture and the
 * keyless demo degrades to n-grams end to end — measured at **0/56** by
 * `npm run verify:replay` before C8, which is the opposite of the capability
 * the demo exists to show ([ADR 0004](../../docs/adr/0004-record-replay-provider.md)).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The only keys the template may supply.
 *
 * A whitelist, not a filter. The template sits one line away from
 * `GOOGLE_GENERATIVE_AI_API_KEY=`, so a loader that used whatever it found
 * there would be one careless edit away from sourcing a credential out of a
 * committed file. Model ids are not secrets; nothing else here is eligible.
 */
export const TEMPLATE_KEYS = [
  'GEMINI_MODEL_FAST',
  'GEMINI_MODEL_STRONG',
  'GEMINI_MODEL_EMBED',
  'GEMINI_MODEL_ADJUDICATE',
  'GEMINI_MODEL_SCORE',
  'EMBED_DIM',
] as const;

const templateCache = new Map<string, Record<string, string>>();

/**
 * Non-secret defaults from `.env.example`, parsed once per path — `aiConfig()`
 * is called per request and per pipeline stage.
 */
export function templateDefaults(
  path: string = join(process.cwd(), '.env.example'),
): Record<string, string> {
  const cached = templateCache.get(path);
  if (cached) return cached;

  const allowed = new Set<string>(TEMPLATE_KEYS);
  const values: Record<string, string> = {};
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, raw] = match;
      const value = raw.trim();
      if (allowed.has(key) && value) values[key] = value;
    }
  }
  templateCache.set(path, values);
  return values;
}

export const aiConfig = () => {
  const template = templateDefaults();
  /** Env always wins; the template only answers where env said nothing. */
  const pick = (...keys: (typeof TEMPLATE_KEYS)[number][]) =>
    keys.map((k) => process.env[k]).find(Boolean) ??
    keys.map((k) => template[k]).find(Boolean) ??
    '';

  return {
    provider: (process.env.AI_PROVIDER ?? 'replay') as 'replay' | 'gemini',
    modelFast: pick('GEMINI_MODEL_FAST'),
    modelStrong: pick('GEMINI_MODEL_STRONG'),
    modelEmbed: pick('GEMINI_MODEL_EMBED'),
    /**
     * Adjudication and scoring are split off the strong tier so each stage can
     * sit in its own daily quota bucket — one 20/day cap must not be able to
     * stall two stages (ADR 0001 amendment). Both fall back to the strong tier,
     * so leaving them unset changes nothing.
     */
    modelAdjudicate: pick('GEMINI_MODEL_ADJUDICATE', 'GEMINI_MODEL_STRONG'),
    modelScore: pick('GEMINI_MODEL_SCORE', 'GEMINI_MODEL_STRONG'),
    embedDim: Number(process.env.EMBED_DIM ?? template.EMBED_DIM ?? 768),
    /** Conservative by default: the free-tier limits are not published. */
    recordRpm: Number(process.env.RECORD_RPM ?? 20),
    embedBatchSize: Number(process.env.EMBED_BATCH_SIZE ?? 16),
    /** Which of the two answered, so a script can print it rather than guess. */
    modelSource: (process.env.GEMINI_MODEL_FAST
      ? 'env'
      : template.GEMINI_MODEL_FAST
        ? 'template'
        : 'unset') as 'env' | 'template' | 'unset',
  };
};

export function requireGeminiConfig() {
  /**
   * Checked against the environment itself rather than the effective config.
   * The template's defaults are exactly right for *replaying* fixtures, but a
   * run that is about to spend real quota should have been told in so many
   * words which models it will bill — `record` is the one command here that
   * costs something.
   */
  const missing = [
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GEMINI_MODEL_FAST',
    'GEMINI_MODEL_STRONG',
    'GEMINI_MODEL_EMBED',
  ].filter((name) => !process.env[name]);
  if (missing.length) {
    // Names only — never the values.
    throw new Error(`missing env: ${missing.join(', ')} (see .env.example)`);
  }
  return aiConfig();
}
