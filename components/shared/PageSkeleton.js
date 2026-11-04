import { cn } from "@/lib/utils";

export function Skeleton({ className }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-xl bg-muted", className)}
    />
  );
}

/** Generic loading UI used by route loading.js files. */
export function PageSkeleton({ cards = 3 }) {
  return (
    <div
      className="mx-auto max-w-7xl px-6 py-10"
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="mb-3 h-8 w-64" />
      <Skeleton className="mb-10 h-4 w-80" />
      <div className="grid gap-5 sm:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <Skeleton className="mt-10 h-64" />
    </div>
  );
}
