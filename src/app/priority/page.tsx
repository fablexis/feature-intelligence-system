import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { connection } from 'next/server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { listProblems, problemStats } from '@/problems/evidence';
import { overrideBandAction } from '@/scoring/actions';
import {
  arrFor,
  citationIndex,
  latestBandOverrides,
  latestRuns,
  runCounts,
} from '@/scoring/runs';
import {
  BAND_RANK,
  BANDS,
  FACTOR_LABELS,
  type Band,
  WEIGHTS_PATH,
  loadWeights,
  scoreProblem,
} from '@/scoring/score';

/**
 * The priority board — a ranking a PM can argue with.
 *
 * The screen is built around one contrast, because it is the contrast the whole
 * product exists to surface: **popularity and value point in opposite
 * directions.** So the raw distinct-account count sits next to the band, not
 * behind a disclosure. A board that showed only the band would be asking for
 * trust; showing the breadth it ranked *below* a narrower problem is what makes
 * the judgement arguable.
 *
 * Nothing here calls a model. The factors were estimated once and stored; the
 * band is arithmetic over them and the weights, recomputed on every render —
 * which is why editing `config/weights.json` re-bands the board immediately.
 */
export const instant = false;

const NOTES: Record<string, string> = {
  'override-recorded': 'Override recorded with its reason. The suggested band is kept alongside it.',
  'override-needs-reason': 'An override needs a reason. Nothing was recorded.',
  'override-same-band': 'That is already the band. Nothing was recorded.',
  'override-invalid': 'Could not record that override.',
};

const BAND_STYLE: Record<Band, 'default' | 'secondary' | 'outline'> = {
  now: 'default',
  next: 'secondary',
  later: 'outline',
  no: 'outline',
};

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;

export default async function PriorityPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }>;
}) {
  // A synchronous SQLite read is invisible to Next's dynamic-read detection,
  // so without this the board would be baked at build time. See /problems.
  await connection();
  const { note } = await searchParams;

  const weights = loadWeights();
  const weightsFile = readFileSync(WEIGHTS_PATH, 'utf8');
  const problems = listProblems(db);
  const stats = problemStats(
    db,
    problems.map((p) => p.id),
  );
  const runs = latestRuns(db);
  const counts = runCounts(db);
  const overrides = latestBandOverrides(db);

  const rows = problems
    .map((problem) => {
      const run = runs.get(problem.id);
      const scored = run ? scoreProblem(run.factors, weights) : null;
      const override = overrides.get(problem.id);
      const effective = (override?.final as Band | undefined) ?? scored?.band ?? null;
      return {
        problem,
        run,
        scored,
        override,
        effective,
        stats: stats.get(problem.id)!,
        arr: arrFor(db, problem.id),
        runCount: counts.get(problem.id) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        (a.effective ? BAND_RANK[a.effective] : 9) - (b.effective ? BAND_RANK[b.effective] : 9) ||
        (b.scored?.raw ?? -1) - (a.scored?.raw ?? -1) ||
        a.problem.id.localeCompare(b.problem.id),
    );

  const scoredCount = rows.filter((r) => r.scored).length;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <div>
        <Link href="/" className="text-muted-foreground text-sm hover:underline">
          ← Home
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Priority</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {scoredCount} of {rows.length} problems scored. Each band is a weighted sum of four
          estimated factors — <strong>no model call happens at render time</strong>, so changing a
          weight re-bands everything immediately. Accounts are shown next to every band on purpose:
          the useful cases are the ones where breadth and value disagree.
        </p>
      </div>

      {note && NOTES[note] && (
        <p className="bg-muted rounded-md px-3 py-2 text-sm" role="status">
          {NOTES[note]}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weights — {weights.version}</CardTitle>
          <CardDescription>
            The weights are the strategy, and they are not AI output. They live in{' '}
            <code>{WEIGHTS_PATH}</code> rather than in this UI so they stay version-controlled and
            diffable — shown here in full, because a weight a reviewer cannot see is a weight they
            cannot argue with.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {Object.entries(weights.weights).map(([key, value]) => (
              <Badge key={key} variant="outline">
                {FACTOR_LABELS[key as keyof typeof FACTOR_LABELS]} × {value}
              </Badge>
            ))}
            <Badge variant="outline">
              bands: now ≥ {weights.bands.now} · next ≥ {weights.bands.next} · later ≥{' '}
              {weights.bands.later}
            </Badge>
          </div>
          <details>
            <summary className="text-muted-foreground cursor-pointer text-sm">
              Show {WEIGHTS_PATH}
            </summary>
            <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-3 text-xs">{weightsFile}</pre>
          </details>
        </CardContent>
      </Card>

      {rows.map(({ problem, run, scored, override, effective, stats: s, arr, runCount }) => {
        const citations = citationIndex(db, problem.id);
        return (
          <Card key={problem.id} id={problem.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                {effective ? (
                  <Badge variant={BAND_STYLE[effective]}>{effective.toUpperCase()}</Badge>
                ) : (
                  <Badge variant="outline">unscored</Badge>
                )}
                {/* Breadth next to the band — the comparison the board exists for. */}
                <Badge variant="outline">
                  {s.strength} account{s.strength === 1 ? '' : 's'}
                </Badge>
                <Badge variant="outline">{usd(arr)} ARR</Badge>
                {override && <Badge variant="outline">overridden by {override.actor}</Badge>}
              </div>
              <CardTitle className="mt-2 text-base font-medium">
                <Link href={`/problems/${problem.id}`} className="hover:underline">
                  {problem.statement}
                </Link>
              </CardTitle>
              <CardDescription>
                {s.requestCount} request{s.requestCount === 1 ? '' : 's'} · ARR is context only; it
                reaches the score through <code>customer_value</code> alone, never through evidence
                strength.
                {run && ` · confidence ${run.factors.confidence.toFixed(2)} · ${runCount} score run${runCount === 1 ? '' : 's'}`}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {!run && (
                <p className="text-muted-foreground text-sm">
                  No factor estimate recorded. Run <code>npm run score</code>. The band is withheld
                  rather than guessed — an unscored problem is not a <code>no</code>.
                </p>
              )}

              {run && scored && (
                <>
                  <div className="flex flex-col gap-2">
                    {scored.contributions.map((c) => {
                      const factor = run.factors[c.key];
                      return (
                        <div key={c.key} className="border-b pb-2 last:border-0">
                          <div className="flex flex-wrap items-baseline gap-2 text-sm">
                            <span className="font-medium">{FACTOR_LABELS[c.key]}</span>
                            <span>{c.score.toFixed(2)}</span>
                            <span className="text-muted-foreground text-xs">
                              × {c.weight} = {c.contribution.toFixed(3)}
                            </span>
                          </div>
                          <p className="text-muted-foreground text-sm">{factor.reason}</p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {factor.citations.length === 0 ? (
                              <span>No citation — shown as unsupported.</span>
                            ) : (
                              <>
                                Cites:{' '}
                                {factor.citations
                                  .map((id) => {
                                    const cited = citations.get(id);
                                    return cited
                                      ? `${cited.title}${cited.accountName ? ` (${cited.accountName})` : ''}`
                                      : `${id} — no longer attached`;
                                  })
                                  .join(' · ')}
                              </>
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-sm">
                    Weighted sum{' '}
                    <strong>
                      {scored.contributions.map((c) => c.contribution.toFixed(3)).join(' + ')} ={' '}
                      {scored.raw.toFixed(3)}
                    </strong>{' '}
                    → band <strong>{scored.band}</strong>. The raw number orders problems inside a
                    band; the band is the output, because 0.71 against 0.69 is noise.
                  </p>

                  {run.factors.tension && (
                    <p className="bg-muted rounded-md px-3 py-2 text-sm">
                      <strong>Tension:</strong> {run.factors.tension}
                    </p>
                  )}

                  {run.weightsVersion !== weights.version && (
                    <p className="text-sm">
                      Estimated under weights <code>{run.weightsVersion}</code>, re-banded here
                      under <code>{weights.version}</code> — arithmetic only, no re-estimation.
                    </p>
                  )}

                  {override && (
                    <p className="bg-muted rounded-md px-3 py-2 text-sm">
                      <strong>Overridden:</strong> {override.suggested} → {override.final}.{' '}
                      {override.reason} — <em>{override.actor}</em>. The suggested band is retained;
                      nothing was overwritten.
                    </p>
                  )}

                  {/* H4: one click and a sentence. Approval is only real when
                      disagreement is cheap. */}
                  <form action={overrideBandAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="problemId" value={problem.id} />
                    <input type="hidden" name="suggested" value={effective ?? scored.band} />
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`band-${problem.id}`} className="text-xs">
                        Override band
                      </label>
                      <select
                        id={`band-${problem.id}`}
                        name="band"
                        defaultValue={effective ?? scored.band}
                        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                      >
                        {BANDS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <label htmlFor={`reason-${problem.id}`} className="text-xs">
                        Reason (required)
                      </label>
                      <input
                        id={`reason-${problem.id}`}
                        name="reason"
                        required
                        minLength={3}
                        placeholder="Why the score is wrong here"
                        className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                      />
                    </div>
                    <Button type="submit" variant="outline" size="sm">
                      Override
                    </Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </main>
  );
}
