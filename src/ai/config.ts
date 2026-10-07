/**
 * All model identity comes from the environment (ADR 0001). Nothing in src/
 * may contain a literal model id — C2's acceptance criteria check that with
 * grep, and a test checks it too.
 */
export const aiConfig = () => ({
  provider: (process.env.AI_PROVIDER ?? 'replay') as 'replay' | 'gemini',
  modelFast: process.env.GEMINI_MODEL_FAST ?? '',
  modelStrong: process.env.GEMINI_MODEL_STRONG ?? '',
  modelEmbed: process.env.GEMINI_MODEL_EMBED ?? '',
  /**
   * Adjudication and scoring are split off the strong tier so each stage can
   * sit in its own daily quota bucket — one 20/day cap must not be able to
   * stall two stages (ADR 0001 amendment). Both default to the strong tier, so
   * leaving them unset changes nothing.
   */
  modelAdjudicate: process.env.GEMINI_MODEL_ADJUDICATE || process.env.GEMINI_MODEL_STRONG || '',
  modelScore: process.env.GEMINI_MODEL_SCORE || process.env.GEMINI_MODEL_STRONG || '',
  embedDim: Number(process.env.EMBED_DIM ?? 768),
  /** Conservative by default: the free-tier limits are not published. */
  recordRpm: Number(process.env.RECORD_RPM ?? 20),
  embedBatchSize: Number(process.env.EMBED_BATCH_SIZE ?? 16),
});

export function requireGeminiConfig() {
  const c = aiConfig();
  const missing = [
    ['GOOGLE_GENERATIVE_AI_API_KEY', process.env.GOOGLE_GENERATIVE_AI_API_KEY],
    ['GEMINI_MODEL_FAST', c.modelFast],
    ['GEMINI_MODEL_STRONG', c.modelStrong],
    ['GEMINI_MODEL_EMBED', c.modelEmbed],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    // Names only — never the values.
    throw new Error(`missing env: ${missing.join(', ')} (see .env.example)`);
  }
  return c;
}
