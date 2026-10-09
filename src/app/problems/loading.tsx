import { RowSkeleton } from '@/components/shell';

/**
 * A skeleton in the geometry of the rows it replaces, not a spinner: the list
 * is read by scanning down the left edge, and a centred spinner moves the eye
 * to the middle of the page and back.
 */
export default function Loading() {
  return (
    <main className="main"><div className="main-in flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="bg-muted h-8 w-48 animate-pulse rounded" />
        <div className="bg-muted h-4 w-full max-w-[60ch] animate-pulse rounded" />
      </div>
      <RowSkeleton rows={8} />
    </div></main>
  );
}
