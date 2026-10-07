'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const STAGES = [
  { key: 'extract', label: 'Extracting the underlying problem' },
  { key: 'embed', label: 'Embedding the problem statement' },
  { key: 'retrieve', label: 'Searching existing problems' },
  { key: 'adjudicate', label: 'Judging same / related / distinct' },
  { key: 'resolve', label: 'Resolving' },
] as const;

type StageState = { ms: number; degraded: boolean; detail?: Record<string, unknown> };
type Done = {
  requestId: string;
  degraded: boolean;
  candidateCount: number;
  resolution:
    | { kind: 'attach'; auto: boolean; score: number; rationale: string; problemId: string }
    | { kind: 'create'; problemId: string };
  problem: { id: string; statement: string; currentWorkaround: string } | null;
};

const DEMO = {
  title: 'Closing the books means a week of retyping',
  bodyRaw:
    'Every period my controller transcribes each total into Sage by hand. It eats most of a week and she has caught several slips after the fact.',
};

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

    const res = await fetch('/api/intake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        bodyRaw,
        source,
        submitterKind: source === 'ae_note' ? 'prospect' : source === 'support_ticket' ? 'support' : source === 'internal' ? 'internal' : 'customer',
        accountId: accountId || undefined,
      }),
    });

    if (!res.body) {
      setError('no response stream');
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
    setRunning(false);
  }

  const outcome = done?.resolution;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit a feature request</CardTitle>
          <CardDescription>
            The problem underneath gets extracted before anything is stored, so a duplicate is
            caught before a record exists.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="border-input bg-background min-h-24 rounded-md border px-3 py-2 text-sm"
            placeholder="What is happening, in your own words"
            value={bodyRaw}
            onChange={(e) => setBodyRaw(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <select
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="customer_direct">Customer, directly</option>
              <option value="csm_note">CSM note</option>
              <option value="ae_note">AE note (prospect)</option>
              <option value="support_ticket">Support ticket</option>
              <option value="internal">Internal</option>
            </select>
            <select
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
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
          <div className="flex gap-2">
            <Button onClick={submit} disabled={running || title.length < 3 || bodyRaw.length < 3}>
              {running ? 'Running…' : 'Submit'}
            </Button>
            <Button
              variant="outline"
              disabled={running}
              onClick={() => {
                setTitle(DEMO.title);
                setBodyRaw(DEMO.bodyRaw);
              }}
            >
              Use the demo request
            </Button>
          </div>
        </CardContent>
      </Card>

      {(running || done) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline</CardTitle>
            <CardDescription>Each stage appears as it finishes, not at the end.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {STAGES.map((stage) => {
              const state = stages[stage.key];
              const skipped = state?.detail?.skipped === true;
              return (
                <div key={stage.key} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-center">
                    {state ? (skipped ? '–' : '✓') : running ? '·' : ' '}
                  </span>
                  <span className={state ? '' : 'text-muted-foreground'}>{stage.label}</span>
                  {state && !skipped && (
                    <span className="text-muted-foreground ml-auto text-xs">{state.ms}ms</span>
                  )}
                  {skipped && (
                    <span className="text-muted-foreground ml-auto text-xs">
                      skipped — nothing to compare against
                    </span>
                  )}
                  {state?.degraded && <Badge variant="outline">degraded</Badge>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm">
            {error} — the request was still stored, never dropped.
          </CardContent>
        </Card>
      )}

      {done && outcome && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {outcome.kind === 'create'
                ? 'Filed as a new problem'
                : outcome.auto
                  ? `Joined an existing problem`
                  : 'Joined an existing problem — pending confirmation'}
            </CardTitle>
            <CardDescription>
              {done.candidateCount} existing problem{done.candidateCount === 1 ? '' : 's'} compared
              {outcome.kind === 'attach' && ` · match score ${outcome.score.toFixed(3)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {done.degraded && (
              <div className="rounded-md border border-dashed p-3">
                <strong>Degraded path.</strong> No recorded model output covered this input, so a
                character-n-gram fallback was used. It cannot match a paraphrase with different
                vocabulary — the headline capability. Add an API key for the real thing.
              </div>
            )}
            {done.problem && (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{done.problem.statement}</span>
                <span className="text-muted-foreground">
                  Workaround today: {done.problem.currentWorkaround}
                </span>
              </div>
            )}
            {outcome.kind === 'attach' && (
              <div className="text-muted-foreground">Why: {outcome.rationale}</div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => router.push(`/problems/${outcome.problemId}`)}
              >
                See the problem and its evidence
              </Button>
              {outcome.kind === 'attach' && (
                <form action="/api/intake/split" method="post">
                  <input type="hidden" name="requestId" value={done.requestId} />
                  <Button type="submit" variant="outline">
                    Actually, mine is different
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
