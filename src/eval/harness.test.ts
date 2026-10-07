/**
 * Structural guards on the harness itself.
 *
 * C7's first acceptance criterion — "runs with no network (replay only)" — and
 * the choice to leave `data/fis.db` alone are both properties of how the script
 * is wired, not of what it prints. A regression in either would still produce a
 * plausible-looking report, which is the worst kind of eval failure: silently
 * measuring something else.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEvalDb } from './db';
import { insertCorpus } from '../seed/corpus';
import { TABLE_NAMES, sql } from '../db/schema';

const script = readFileSync('./scripts/eval.ts', 'utf8');

describe('npm run eval cannot reach the network', () => {
  it('forces the replay provider regardless of AI_PROVIDER', () => {
    expect(script).toMatch(/process\.env\.AI_PROVIDER\s*=\s*'replay'/);
  });

  it('replaces global fetch with a thrower, and counts attempts', () => {
    expect(script).toMatch(/globalThis\.fetch\s*=/);
    expect(script).toMatch(/networkAttempts/);
  });

  it('never constructs the configured provider factory', () => {
    // createAiProvider() honours AI_PROVIDER; the eval must not depend on env
    // being right, so it names the replay provider directly.
    expect(script).not.toMatch(/createAiProvider/);
    expect(script).toMatch(/createReplayProvider/);
  });
});

describe('npm run eval cannot disturb the demo database', () => {
  it('does not open the default connection', () => {
    expect(script).not.toMatch(/createDb|DB_PATH|from '\.\.\/src\/db\/index'/);
    expect(script).toMatch(/createEvalDb/);
  });

  it('builds its database in memory', () => {
    expect(readFileSync('./src/eval/db.ts', 'utf8')).toContain("':memory:'");
  });
});

describe('the ephemeral database', () => {
  it('migrates to the full schema and takes the corpus', () => {
    const db = createEvalDb();
    const names = db.all<{ name: string }>(
      sql.raw(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'",
      ),
    );
    expect(names.map((n) => n.name).sort()).toEqual([...TABLE_NAMES].sort());

    const counts = insertCorpus(db);
    expect(counts.requests).toBeGreaterThan(40);
    // Idempotent, like `npm run seed`.
    expect(() => insertCorpus(db)).not.toThrow();
  });

  it('starts with no problems, so the eval can never be handed its answers', () => {
    const db = createEvalDb();
    insertCorpus(db);
    expect(db.get<{ n: number }>(sql.raw('select count(*) as n from problems'))?.n).toBe(0);
  });
});
