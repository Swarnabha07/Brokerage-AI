"use client";

import { ErrorState } from "@/components/shared/ErrorState";

export default function Error({ error, reset }) {
  return <ErrorState onRetry={reset} />;
}
