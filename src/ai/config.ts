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
