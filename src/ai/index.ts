import { aiConfig } from './config';
import { createGeminiProvider } from './gemini';
import { createReplayProvider } from './replay';
import type { AiProvider } from './types';

/**
 * Default is `replay`: the project must work for a reviewer with no key, and
 * the keyless path should be the one that gets exercised by default rather
 * than the exception.
 */
export function createAiProvider(): AiProvider {
  return aiConfig().provider === 'gemini' ? createGeminiProvider() : createReplayProvider();
}

export * from './types';
export * from './schemas';
export { cosine } from './ngram';
export { withDecisionLog } from './decisions';
export { aiConfig };
