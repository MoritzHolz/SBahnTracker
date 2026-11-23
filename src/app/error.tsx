"use client";

import { ErrorScreen } from "@/components/ErrorBoundary";

export default function Error() {
  return <ErrorScreen onRetry={() => window.location.reload()} />;
}
