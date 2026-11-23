import type { Metadata } from "next";
import { Suspense } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { VehicleSearch } from "@/components/panels/VehicleSearch";

export const metadata: Metadata = {
  title: "Fahrzeugsuche · S-Bahn Stuttgart Live",
};

export default function FahrzeugePage() {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <VehicleSearch />
      </Suspense>
    </ErrorBoundary>
  );
}
