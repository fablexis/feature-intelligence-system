import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TABLE_NAMES } from '@/db/schema';

const TASKS = [
  { id: 'C1', name: 'Project skeleton', done: true },
  { id: 'C6', name: 'Seed corpus with labels', done: false },
  { id: 'C2', name: 'Provider abstraction + record/replay', done: false },
  { id: 'C3', name: 'Intake pipeline + three-way resolution', done: false },
  { id: 'C7', name: 'Eval harness', done: false },
  { id: 'C4', name: 'Problem detail', done: false },
  { id: 'C5', name: 'Explainable priority', done: false },
  { id: 'C8', name: 'Instrumentation + README', done: false },
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

      <Button className="mt-6" disabled>
        Submit a request — C3
      </Button>
    </main>
  );
}
