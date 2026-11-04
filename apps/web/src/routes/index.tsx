import { createFileRoute } from "@tanstack/react-router";

import { GraphBackendStatus } from "@/components/graph-backend-status";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">trading-terminal</h1>
        <p className="mt-1 text-sm text-muted-foreground">TanStack Router, postgres.</p>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Tasks</h2>
        <p className="text-sm text-muted-foreground">
          This stack has no database-backed task API yet. Replace this panel with your first
          feature.
        </p>
      </section>

      <footer className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"></footer>
    </div>
  );
}
