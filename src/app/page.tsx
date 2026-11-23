import { ErrorBoundary } from "@/components/ErrorBoundary";
import LiveApp from "@/components/LiveApp";

export default function Home() {
  return (
    <ErrorBoundary>
      <LiveApp />
    </ErrorBoundary>
  );
}
