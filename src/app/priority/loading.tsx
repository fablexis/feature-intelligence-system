import { RowSkeleton } from '@/components/shell';

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 pt-8 pb-16">
      <div className="flex flex-col gap-3">
        <div className="bg-muted h-8 w-32 animate-pulse rounded" />
        <div className="bg-muted h-4 w-full max-w-[60ch] animate-pulse rounded" />
        <div className="flex gap-8 pt-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-muted h-10 w-14 animate-pulse rounded" />
          ))}
        </div>
      </div>
      <RowSkeleton rows={6} />
    </main>
  );
}
