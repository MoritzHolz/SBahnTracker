"use client";

import type { ViewProps } from "./shared";

/** Tages- und Nachtansicht – Platzhalter, wird von einem Agent umgesetzt */
export function TimeWindowView(_p: ViewProps & { mode: "tag" | "nacht" }) {
  return <p className="rounded-lg border border-line px-5 py-8 text-center text-[13px] text-muted">Zeitachse folgt.</p>;
}
