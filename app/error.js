"use client";

import { ErrorState } from "@/components/shared/ErrorState";

export default function Error({ retry }) {
  return <ErrorState onRetry={retry} />;
}
