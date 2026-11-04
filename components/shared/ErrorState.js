"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 px-6 py-20 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert className="h-5 w-5" aria-hidden="true" />
      </span>
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {description ?? "An unexpected error occurred while loading this page."}
      </p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
