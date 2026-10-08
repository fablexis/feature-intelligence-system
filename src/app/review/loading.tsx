export default function Loading() {
  return (
    <main className="main"><div className="main-in flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="bg-muted h-8 w-44 animate-pulse rounded" />
        <div className="bg-muted h-4 w-full max-w-[60ch] animate-pulse rounded" />
      </div>
      <div className="flex flex-col gap-4" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border p-5">
            <div className="bg-muted h-6 w-28 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
            <div className="bg-muted h-12 w-full animate-pulse rounded" />
            <div className="bg-muted h-16 w-full animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </div></main>
  );
}
