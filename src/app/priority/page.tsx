import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { connection } from 'next/server';
import { Button } from '@/components/ui/button';
import { AppShell, EmptyState, Metric, Note, PageHeader } from '@/components/shell';
import { BandChip, type BandName, Flag, Measure } from '@/components/signals';
import { db } from '@/db';
import { listProblems, problemStats } from '@/problems/evidence';
import { scoreProvenance } from '@/problems/provenance';
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
 * The priority board — a ranking a PM can argue with, legible from the back of
 * a meeting room.
 *
 * The screen is built around one contrast, because it is the contrast the whole
 * product exists to surface: **popularity and value point in opposite
 * directions.** So the band and the raw distinct-account count are the two
 * largest things on each row and they never separate — DEMO Beat 2 is "fewer
 * accounts, higher band", and that has to read in two seconds on a projector
 * rather than after a paragraph.
 *
 * E1 re-cut the layout and nothing else: rows grouped by band instead of 23
 * stacked cards each holding an open form, with the factor decomposition behind
 * a disclosure. The decomposition is the justification, and justification is
 * what you open when you disagree — it is not what you scan.
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

const BAND_CAPTION: Record<Band, string> = {
  now: 'Worth starting against everything else on this list',
  next: 'Queued behind the now band',
  later: 'Real, and not now',
  no: 'Not worth doing — recorded so it stops being re-litigated',
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
  const problemIds = problems.map((p) => p.id);
  const stats = problemStats(db, problemIds);
  const runs = latestRuns(db);
  const counts = runCounts(db);
  const overrides = latestBandOverrides(db);
  const models = scoreProvenance(db, problemIds);

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
        model: models.get(problem.id),
      };
    })
    .sort(
      (a, b) =>
        (a.effective ? BAND_RANK[a.effective] : 9) - (b.effective ? BAND_RANK[b.effective] : 9) ||
        (b.scored?.raw ?? -1) - (a.scored?.raw ?? -1) ||
        a.problem.id.localeCompare(b.problem.id),
    );

  const scoredCount = rows.filter((r) => r.scored).length;
  const bandCounts = BANDS.map((band) => ({
    band,
    rows: rows.filter((r) => r.effective === band),
  }));
  const unscored = rows.filter((r) => !r.effective);

  return (
    <AppShell current="/priority" width="max-w-5xl">
      <PageHeader
        title="Priority"
        metrics={
          <>
            {bandCounts.map(({ band, rows: group }) => (
              <Metric key={band} label={band} value={group.length} />
            ))}
            {unscored.length > 0 && <Metric label="unscored" value={unscored.length} />}
            <Metric label="weights" value={weights.version} hint="PM-owned, in version control" />
          </>
        }
      >
        {scoredCount} of {rows.length} problems scored. Each band is a weighted sum of four
        estimated factors — <strong>no model call happens at render time</strong>, so changing a
        weight re-bands everything immediately. The distinct-account count sits beside every band on
        purpose: the useful rows are the ones where breadth and value disagree.
      </PageHeader>

      {note && NOTES[note] && <Note>{NOTES[note]}</Note>}

      {/* The weights are the strategy, and they are not AI output. Compact by
          default, in full on demand — a weight nobody can see is a weight
          nobody can argue with. */}
      <details className="rounded-lg border px-4 py-3">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Weights {weights.version}</span>
          {Object.entries(weights.weights).map(([key, value]) => (
            <span key={key} className="text-muted-foreground num text-xs">
              {FACTOR_LABELS[key as keyof typeof FACTOR_LABELS]} ×{' '}
              <span className="text-foreground font-mono">{value}</span>
            </span>
          ))}
          <span className="text-muted-foreground num text-xs">
            now ≥ <span className="text-foreground font-mono">{weights.bands.now}</span> · next ≥{' '}
            <span className="text-foreground font-mono">{weights.bands.next}</span> · later ≥{' '}
            <span className="text-foreground font-mono">{weights.bands.later}</span>
          </span>
        </summary>
        <p className="text-muted-foreground mt-3 max-w-[70ch] text-sm leading-relaxed">
          They live in <code className="font-mono">{WEIGHTS_PATH}</code> rather than in this UI so
          they stay version-controlled and diffable (D6).
        </p>
        <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-3 font-mono text-xs">
          {weightsFile}
        </pre>
      </details>

      {rows.length === 0 && (
        <EmptyState
          title="Nothing to rank yet"
          command={'npm run seed\nnpm run ingest\nnpm run score'}
        >
          The board ranks problems the pipeline formed, and seeding deliberately creates none. Form
          them, then estimate the factors.
        </EmptyState>
      )}

      {rows.length > 0 && scoredCount === 0 && (
        <EmptyState title="Formed, but never scored" command="npm run score">
          Every problem reads <code className="font-mono">unscored</code> because no factor estimate
          exists. The band is withheld rather than guessed — an unscored problem is not a{' '}
          <code className="font-mono">no</code>.
        </EmptyState>
      )}

      {[...bandCounts, { band: null, rows: unscored }].map(({ band, rows: group }) => {
        if (group.length === 0) return null;
        return (
          <section key={band ?? 'unscored'} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-3 border-b pb-2">
              <h2 className="num text-sm font-semibold tracking-wide uppercase">
                {band ?? 'unscored'} · {group.length}
              </h2>
              <p className="text-muted-foreground text-xs">
                {band ? BAND_CAPTION[band] : 'No factor estimate recorded'}
              </p>
            </div>

            {group.map(({ problem, run, scored, override, effective, stats: s, arr, runCount, model }) => {
              const citations = citationIndex(db, problem.id);
              return (
                <div key={problem.id} id={problem.id} className="rounded-xl border">
                  {/* The scan line: band, breadth, money, statement. Nothing
                      else is allowed to compete at this size. */}
                  <div className="flex flex-wrap items-start gap-x-5 gap-y-3 p-4">
                    <BandChip band={effective as BandName | null} size="lg" />
                    <div className="flex items-baseline gap-1.5">
                      <span className="num text-2xl leading-none font-semibold tracking-tight">
                        {s.strength}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        account{s.strength === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="num text-2xl leading-none font-semibold tracking-tight">
                        {usd(arr)}
                      </span>
                      <span className="text-muted-foreground text-xs">ARR</span>
                    </div>
                    <div className="min-w-[18rem] flex-1">
                      <Link
                        href={`/problems/${problem.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {problem.statement}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="text-muted-foreground num text-xs">
                          {s.requestCount} request{s.requestCount === 1 ? '' : 's'}
                        </span>
                        {scored && <Measure label="score" value={scored.raw.toFixed(3)} />}
                        {run && (
                          <Measure label="confidence" value={run.factors.confidence.toFixed(2)} />
                        )}
                        {s.needsReview > 0 && (
                          <Flag>
                            {s.needsReview} need{s.needsReview === 1 ? 's' : ''} review
                          </Flag>
                        )}
                        {override && (
                          <span className="text-muted-foreground text-xs">
                            overridden by {override.actor}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {!run && (
                    <p className="text-muted-foreground border-t px-4 py-3 text-sm">
                      No factor estimate recorded. Run <code className="font-mono">npm run score</code>
                      . The band is withheld rather than guessed.
                    </p>
                  )}

                  {run && scored && (
                    <details className="border-t">
                      <summary className="text-muted-foreground hover:bg-muted/50 cursor-pointer px-4 py-2.5 text-sm transition-colors">
                        Why this band — four factors, their citations, and the override
                      </summary>
                      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
                        <div className="flex flex-col">
                          {scored.contributions.map((c) => {
                            const factor = run.factors[c.key];
                            return (
                              <div key={c.key} className="border-b py-2.5 last:border-0">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                                  <span className="font-medium">{FACTOR_LABELS[c.key]}</span>
                                  <span className="num font-mono">{c.score.toFixed(2)}</span>
                                  <span className="text-muted-foreground num font-mono text-xs">
                                    × {c.weight} = {c.contribution.toFixed(3)}
                                  </span>
                                </div>
                                <p className="mt-0.5 max-w-[70ch] text-sm leading-relaxed">
                                  {factor.reason}
                                </p>
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

                        <p className="max-w-[70ch] text-sm leading-relaxed">
                          Weighted sum{' '}
                          <strong className="num font-mono">
                            {scored.contributions.map((c) => c.contribution.toFixed(3)).join(' + ')}{' '}
                            = {scored.raw.toFixed(3)}
                          </strong>{' '}
                          → band <strong>{scored.band}</strong>. The raw number orders problems
                          inside a band; the band is the output, because 0.71 against 0.69 is noise.
                        </p>

                        {run.factors.tension && (
                          <p className="bg-muted/60 max-w-[70ch] rounded-md px-3 py-2 text-sm leading-relaxed">
                            <strong>Tension:</strong> {run.factors.tension}
                          </p>
                        )}

                        <p className="text-muted-foreground max-w-[70ch] text-xs leading-relaxed">
                          Estimated by{' '}
                          <code className="font-mono">{model?.modelId ?? run.modelId}</code>
                          {model && ` via ${model.provider}`}
                          {model?.promptVersion && (
                            <>
                              {' '}
                              on prompt <code className="font-mono">{model.promptVersion}</code>
                            </>
                          )}
                          , under weights <code className="font-mono">{run.weightsVersion}</code>
                          {run.weightsVersion !== weights.version && (
                            <>
                              {' '}
                              and re-banded here under{' '}
                              <code className="font-mono">{weights.version}</code> — arithmetic
                              only, no re-estimation
                            </>
                          )}
                          . {runCount} score run{runCount === 1 ? '' : 's'} on record; the factors
                          are estimates and nothing in this build measures their quality.
                        </p>

                        {override && (
                          <p className="bg-muted/60 max-w-[70ch] rounded-md px-3 py-2 text-sm leading-relaxed">
                            <strong>Overridden:</strong>{' '}
                            <span className="num font-mono">
                              {override.suggested} → {override.final}
                            </span>
                            . {override.reason} — <em>{override.actor}</em>. The suggested band is
                            retained; nothing was overwritten.
                          </p>
                        )}

                        {/* H4: one click and a sentence. Approval is only real
                            when disagreement is cheap. */}
                        <form
                          action={overrideBandAction}
                          className="flex flex-wrap items-end gap-2 border-t pt-3"
                        >
                          <input type="hidden" name="problemId" value={problem.id} />
                          <input type="hidden" name="suggested" value={effective ?? scored.band} />
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`band-${problem.id}`} className="text-xs font-medium">
                              Override band
                            </label>
                            <select
                              id={`band-${problem.id}`}
                              name="band"
                              defaultValue={effective ?? scored.band}
                              className="border-input bg-background focus-visible:ring-ring/50 h-9 rounded-md border px-2 text-sm focus-visible:ring-3 focus-visible:outline-none"
                            >
                              {BANDS.map((b) => (
                                <option key={b} value={b}>
                                  {b}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                            <label htmlFor={`reason-${problem.id}`} className="text-xs font-medium">
                              Reason (required)
                            </label>
                            <input
                              id={`reason-${problem.id}`}
                              name="reason"
                              required
                              minLength={3}
                              placeholder="Why the score is wrong here"
                              className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-3 focus-visible:outline-none"
                            />
                          </div>
                          <Button type="submit" variant="outline" size="lg">
                            Override
                          </Button>
                        </form>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </AppShell>
  );
}
