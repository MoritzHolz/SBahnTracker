"use client";

import { Component, type ReactNode } from "react";

export function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold tracking-tight">Da ist etwas schiefgelaufen</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Die Ansicht konnte nicht dargestellt werden. Meist hilft es, die Seite neu zu laden.
        </p>
        <button
          onClick={onRetry}
          className="mt-5 h-9 rounded-md border border-[var(--line-strong)] bg-white/[0.06] px-4 text-[13px] font-medium hover:bg-white/[0.1]"
        >
          Neu laden
        </button>
      </div>
    </main>
  );
}

/** Fängt Renderfehler ab und zeigt eine freundliche Meldung statt eines weißen Bildschirms. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (this.state.failed) return <ErrorScreen onRetry={() => window.location.reload()} />;
    return this.props.children;
  }
}
