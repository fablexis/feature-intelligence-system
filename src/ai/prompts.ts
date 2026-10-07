import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './hash';

/**
 * Prompts live in /prompts as the canonical, reviewable artefact.
 *
 * The version is derived from the prompt's own content, so editing a prompt
 * automatically changes every fixture key that depended on it. Staleness is
 * therefore impossible to forget about rather than merely documented.
 */
const CACHE = new Map<string, { text: string; version: string }>();

function load(name: string) {
  const cached = CACHE.get(name);
  if (cached) return cached;
  const text = readFileSync(join(process.cwd(), 'prompts', `${name}.md`), 'utf8');
  const loaded = { text, version: `v1-${sha256(text).slice(0, 8)}` };
  CACHE.set(name, loaded);
  return loaded;
}

export const prompt = {
  extract: () => load('extract'),
  adjudicate: () => load('adjudicate'),
  factors: () => load('factors'),
};

/** Embedding has no prompt; its fixture key still needs a stable component. */
export const EMBED_PROMPT_VERSION = 'embed-v1';
