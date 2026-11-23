import type { Metadata } from "next";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ScannerPanel } from "@/components/panels/ScannerPanel";

export const metadata: Metadata = {
  title: "Live-Webscanner · S-Bahn Stuttgart Live",
};

export default function ScannerPage() {
  return (
    <ErrorBoundary>
      <ScannerPanel />
    </ErrorBoundary>
  );
}
