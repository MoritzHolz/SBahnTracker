import type { Metadata } from "next";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { StablingPanel } from "@/components/panels/StablingPanel";

export const metadata: Metadata = {
  title: "Abstellprotokoll · S-Bahn Stuttgart Live",
};

export default function StablingPage() {
  return (
    <ErrorBoundary>
      <StablingPanel />
    </ErrorBoundary>
  );
}
