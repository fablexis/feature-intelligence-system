import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TABLE_NAMES } from '@/db/schema';

const TASKS = [
  { id: 'C1', name: 'Project skeleton', done: true },
  { id: 'C6', name: 'Seed corpus with labels', done: true },
  { id: 'C2', name: 'Provider abstraction + record/replay', done: true },
  { id: 'C3', name: 'Intake pipeline + three-way resolution', done: true },
  { id: 'C7', name: 'Eval harness', done: true },
  { id: 'C4', name: 'Problem detail', done: true },
  { id: 'C5', name: 'Explainable priority', done: true },
  { id: 'C8', name: 'Instrumentation + README', done: true },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Feature Intelligence System</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Turns unstructured feature requests into evidence about problems, not votes on solutions.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Build progress</CardTitle>
          <CardDescription>
            Execution order from docs/TASKS.md · {TABLE_NAMES.length} tables migrated
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {TASKS.map((task) => (
            <div key={task.id} className="flex items-center gap-3 text-sm">
              <Badge variant={task.done ? 'default' : 'outline'}>{task.id}</Badge>
              <span className={task.done ? '' : 'text-muted-foreground'}>{task.name}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="mt-6 flex gap-2">
        <Link
          href="/problems"
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
        >
          Browse problems
        </Link>
        <Link
          href="/priority"
          className="hover:bg-muted inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
        >
          Priority board
        </Link>
        <Link
          href="/intake"
          className="hover:bg-muted inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
        >
          Submit a request
        </Link>
      </div>
    </main>
  );
}
