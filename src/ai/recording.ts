import { aiConfig } from './config';
import { type FixtureEntry, loadFixtures, round6, saveFixtures } from './fixtures';
import { createGeminiProvider } from './gemini';
import { createReplayProvider } from './replay';
import { withRetry } from './retry';
import type { AiProvider, AiResult, Stage } from './types';

/**
 * Record-through provider: serve a fixture if one exists, otherwise call the
 * real model, save the result, and return it.
 *
 * This is what makes a stalled recording run free to resume. A pass that dies
 * at call 40 of 54 has already persisted 40 fixtures, so the next run spends
 * quota only on the remaining 14 — which matters when the daily cap is small
 * and unpublished (ADR 0001).
 *
 * The fixture key is taken from the live provider's own `meta.inputHash`, so a
 * recorded entry is guaranteed to be found by the replay provider's lookup.
 * Computing it twice, independently, is how keys silently drift apart.
 */
export function createRecordingProvider(onCall?: (stage: Stage) => void): AiProvider {
  const fixtures = loadFixtures();
  const replay = createReplayProvider(fixtures);
  const live = createGeminiProvider();

  const save = (stage: Stage, key: string, output: unknown, tokens?: number) => {
    const entry: FixtureEntry = { key, stage, output, tokens };
    fixtures.set(key, entry);
    saveFixtures(fixtures); // checkpoint per call — a crash loses nothing
  };

  /** Prefer the fixture; spend quota only when there isn't one. */
  async function through<T>(
    stage: Stage,
    label: string,
    fromReplay: () => Promise<AiResult<T>>,
    fromLive: () => Promise<AiResult<T>>,
    serialise: (value: T) => unknown = (v) => v,
  ): Promise<AiResult<T>> {
    const replayed = await fromReplay();
    if (!replayed.meta.degraded) return replayed;
    onCall?.(stage);
    const fresh = await withRetry(label, fromLive);
    save(stage, fresh.meta.inputHash, serialise(fresh.value), fresh.meta.tokens);
    return fresh;
  }

  return {
    name: 'gemini',
    extractProblem: (i) =>
      through('extract', `extract ${i.title.slice(0, 28)}`, () => replay.extractProblem(i), () =>
        live.extractProblem(i),
      ),
    embed: (i) =>
      through(
        'embed',
        'embed',
        () => replay.embed(i),
        () => live.embed(i),
        (v) => Array.from(v.vector, round6),
      ),
    adjudicate: (i) =>
      through(
        'adjudicate',
        `adjudicate ${i.candidates.length} cand`,
        () => replay.adjudicate(i),
        () => live.adjudicate(i),
      ),
    estimateFactors: (i) =>
      through('score', 'factors', () => replay.estimateFactors(i), () =>
        live.estimateFactors(i),
      ),
  };
}

export const recordRpmGap = () => Math.ceil(60_000 / Math.max(aiConfig().recordRpm, 1));
