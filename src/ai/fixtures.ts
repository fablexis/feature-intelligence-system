import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Stage } from './types';

/**
 * The fixture store: real model outputs, keyed by hash, committed to the repo
 * so the demo runs offline on genuine semantic matching (ADR 0004).
 *
 * Entries hold **model output only**. No API key, no request headers, no
 * provider metadata beyond the model id that produced the entry. A test
 * asserts this, because a fixture file is the easiest place in a project like
 * this to leak a credential by accident.
 */
export type FixtureEntry = { key: string; stage: Stage; output: unknown; tokens?: number };

export type Manifest = {
  recordedAt: string;
  models: { fast: string; strong: string; embed: string };
  embedDim: number;
  promptVersions: Record<string, string>;
  counts: Record<string, number>;
  /** Stages not yet recorded, and why. */
  pending: Record<string, string>;
};

const DIR = () => join(process.cwd(), 'fixtures');
const STORE = () => join(DIR(), 'outputs.json');
const MANIFEST = () => join(DIR(), 'manifest.json');

/** Embeddings dominate file size; 6dp is far below cosine's sensitivity. */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function loadFixtures(): Map<string, FixtureEntry> {
  if (!existsSync(STORE())) return new Map();
  const raw = JSON.parse(readFileSync(STORE(), 'utf8')) as FixtureEntry[];
  return new Map(raw.map((e) => [e.key, e]));
}

export function saveFixtures(entries: Map<string, FixtureEntry>) {
  mkdirSync(DIR(), { recursive: true });
  const sorted = [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(STORE(), `${JSON.stringify(sorted, null, 1)}\n`);
}

export function loadManifest(): Manifest | null {
  if (!existsSync(MANIFEST())) return null;
  return JSON.parse(readFileSync(MANIFEST(), 'utf8')) as Manifest;
}

export function saveManifest(manifest: Manifest) {
  mkdirSync(DIR(), { recursive: true });
  writeFileSync(MANIFEST(), `${JSON.stringify(manifest, null, 2)}\n`);
}
