'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DegradedNotice, Flag, Measure, Provenance } from '@/components/signals';

const STAGES = [
  { key: 'extract', label: 'Reading what the problem underneath actually is' },
  { key: 'embed', label: 'Turning it into something comparable by meaning' },
  { key: 'retrieve', label: 'Searching the problems we already track' },
  { key: 'adjudicate', label: 'Deciding: same problem, related, or new' },
  { key: 'resolve', label: 'Filing it' },
] as const;

type StageState = { ms: number; degraded: boolean; detail?: Record<string, unknown> };
type Done = {
  requestId: string;
  degraded: boolean;
  candidateCount: number;
  resolution:
    | {
        kind: 'attach';
        auto: boolean;
        /** min(verdict confidence, cosine) — the scalar T_auto is applied to. */
        score: number;
        confidence: number;
        rationale: string;
        problemId: string;
      }
    | { kind: 'create'; problemId: string };
  problem: { id: string; statement: string; currentWorkaround: string } | null;
};

const DEMO = {
  title: 'Closing the books means a week of retyping',
  bodyRaw:
    'Every period my controller transcribes each total into Sage by hand. It eats most of a week and she has caught several slips after the fact.',
};

/**
 * The three outcomes are the screen, so they are styled as three different
 * things rather than three copies of one card
 * ([ADR 0005](../../../docs/adr/0005-duplicate-resolution-actor.md)):
 *
 *  - **auto-attach** — the pipeline was sure, nobody is being asked;
 *  - **attached, pending confirmation** — flagged in the reserved amber,
 *    because the PM queue now owes it a look;
 *  - **new problem** — neutral, because nothing was merged and there is nothing
 *    to second-guess.
 *
 * A submitter has ~60 seconds of attention, and "did my thing join something or
 * not" has to be answerable from across the room.
 */
const OUTCOME = {
  auto: {
    frame: 'border-band-now/40 bg-band-next',
    eyebrow: 'This is a problem we already track',
    tone: 'text-band-next-fg',
  },
  pending: {
    frame: 'border-flag-border bg-flag',
    eyebrow: 'Probably one we already track — a PM will confirm',
    tone: 'text-flag-fg',
  },
  create: {
    frame: 'border-border bg-muted/40',
    eyebrow: 'This is new. Filed as its own problem',
    tone: 'text-foreground',
  },
} as const;

export function IntakeForm({ accounts }: { accounts: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [bodyRaw, setBodyRaw] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [source, setSource] = useState('customer_direct');
  const [stages, setStages] = useState<Record<string, StageState>>({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setRunning(true);
    setStages({});
    setDone(null);
    setError(null);

    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          bodyRaw,
          source,
          submitterKind:
            source === 'ae_note'
              ? 'prospect'
              : source === 'support_ticket'
                ? 'support'
                : source === 'internal'
                  ? 'internal'
                  : 'customer',
          accountId: accountId || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        setError(
          res.ok
            ? 'The server accepted it but sent nothing back, so none of the steps could be shown.'
            : `The server would not accept this submission (error ${res.status}).`,
        );
        setRunning(false);
        return;
      }

      // Each stage is a line, rendered the moment it arrives.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'stage') {
            setStages((prev) => ({
              ...prev,
              [event.stage]: { ms: event.ms, degraded: event.degraded, detail: event.detail },
            }));
          } else if (event.type === 'done') {
            setDone(event as Done);
          } else if (event.type === 'error') {
            setError(event.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'the request never reached the server');
    }
    setRunning(false);
  }

  const outcome = done?.resolution;
  const kind = !outcome ? null : outcome.kind === 'create' ? 'create' : outcome.auto ? 'auto' : 'pending';
  const style = kind ? OUTCOME[kind] : null;
  // The first stage with no result yet, while the stream is still open.
  const pending = running ? STAGES.find((s) => !stages[s.key])?.key : undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* No heading and no blurb: the page header above says what this is,
          and saying it twice costs a 60-second submitter their first field. */}
      <div className="flex flex-col gap-3 rounded-xl border p-5">
        <label htmlFor="title" className="text-xs font-medium">
          Title
        </label>
        <input
          id="title"
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm focus-visible:ring-3 focus-visible:outline-none"
          placeholder="One line, as the submitter would put it"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label htmlFor="body" className="text-xs font-medium">
          What is happening, in your own words
        </label>
        <textarea
          id="body"
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring/50 min-h-24 rounded-md border px-3 py-2 text-sm leading-relaxed focus-visible:ring-3 focus-visible:outline-none"
          placeholder="Ask for a feature if that is how they put it — it reads past the wording to the problem"
          value={bodyRaw}
          onChange={(e) => setBodyRaw(e.target.value)}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="source" className="text-xs font-medium">
              Channel
            </label>
            <select
              id="source"
              className="border-input bg-background focus-visible:ring-ring/50 h-9 rounded-md border px-2 text-sm focus-visible:ring-3 focus-visible:outline-none"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="customer_direct">Customer, directly</option>
              <option value="csm_note">CSM note</option>
              <option value="ae_note">AE note (prospect)</option>
              <option value="support_ticket">Support ticket</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="account" className="text-xs font-medium">
              Account
            </label>
            <select
              id="account"
              className="border-input bg-background focus-visible:ring-ring/50 h-9 rounded-md border px-2 text-sm focus-visible:ring-3 focus-visible:outline-none"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="lg"
              disabled={running}
              onClick={() => {
                setTitle(DEMO.title);
                setBodyRaw(DEMO.bodyRaw);
              }}
            >
              Use the demo request
            </Button>
            <Button
              size="lg"
              onClick={submit}
              disabled={running || title.length < 3 || bodyRaw.length < 3}
            >
              {running ? 'Running…' : 'Submit'}
            </Button>
          </div>
        </div>
      </div>

      {(running || done) && (
        <div className="flex flex-col gap-2 rounded-xl border p-5">
          <h2 className="text-sm font-semibold tracking-wide uppercase">What it is doing</h2>
          <p className="text-muted-foreground text-xs">
            Each step shows as it finishes rather than all at the end, so a few seconds of work
            does not read as a hang.
          </p>
          <ol className="mt-1 flex flex-col">
            {STAGES.map((stage) => {
              const state = stages[stage.key];
              const skipped = state?.detail?.skipped === true;
              const active = pending === stage.key;
              return (
                <li
                  key={stage.key}
                  className="flex items-center gap-3 border-b py-2 text-sm last:border-0"
                >
                  <span
                    aria-hidden
                    className={`num w-4 text-center font-mono text-xs ${
                      state ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {state ? (skipped ? '–' : '✓') : active ? '•' : ''}
                  </span>
                  <span
                    className={
                      state ? '' : active ? 'animate-pulse' : 'text-muted-foreground opacity-60'
                    }
                  >
                    {stage.label}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {state?.degraded && <Flag>degraded</Flag>}
                    {skipped ? (
                      <span className="text-muted-foreground text-xs">
                        skipped — nothing to compare against
                      </span>
                    ) : (
                      state && <Measure label="took" value={`${state.ms}ms`} />
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {error && (
        <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-1 rounded-xl border p-5">
          <p className="text-destructive text-sm font-semibold">Something broke partway through</p>
          <p className="max-w-[70ch] text-sm leading-relaxed">
            {error} <strong>Your request was still saved</strong> — nothing is ever dropped. It just
            has not been filed against a problem yet, and will be when this runs again.
          </p>
        </div>
      )}

      {done && outcome && style && (
        <div className={`flex flex-col gap-4 rounded-xl border p-5 ${style.frame}`}>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className={`font-semibold ${style.tone}`}>{style.eyebrow}</h2>
              {kind === 'pending' && <Flag>needs review</Flag>}
            </div>
            <p className={`text-xs ${style.tone} opacity-90`}>
              Checked against{' '}
              <span className="num font-mono">{done.candidateCount}</span> problem
              {done.candidateCount === 1 ? '' : 's'} we already track
              {kind === 'pending' && ' · filed there, but not confidently enough to decide alone'}
              {kind === 'auto' && ' · confident enough to file it without asking anyone'}
            </p>
          </div>

          {done.degraded && <DegradedNotice where="this match" />}

          {done.problem && (
            <div className="bg-background flex flex-col gap-1 rounded-md border p-3">
              <span className="font-medium">{done.problem.statement}</span>
              <span className="text-muted-foreground text-sm">
                How customers cope with it today: {done.problem.currentWorkaround}
              </span>
            </div>
          )}

          {outcome.kind === 'attach' && (
            <Provenance
              verdict="same"
              confidence={outcome.confidence}
              similarity={outcome.score}
              similarityLabel="match score"
              rationale={outcome.rationale}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => router.push(`/problems/${outcome.problemId}`)}>
              See the problem and who else raised it
            </Button>
            {outcome.kind === 'attach' && (
              <form action="/api/intake/split" method="post">
                <input type="hidden" name="requestId" value={done.requestId} />
                <Button type="submit" size="lg" variant="outline">
                  Actually, mine is different
                </Button>
              </form>
            )}
          </div>
          {outcome.kind === 'attach' && (
            <p className={`max-w-[70ch] text-xs leading-relaxed ${style.tone} opacity-90`}>
              That second button matters more than it looks. If this match is wrong, the only person
              who can tell is you — so saying so takes one click, files your request on its own, and
              puts the disagreement on record instead of losing it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
