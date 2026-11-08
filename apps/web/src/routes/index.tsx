import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const { loading, authenticated, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !authenticated) {
      navigate({ to: "/login" });
    }
  }, [loading, authenticated, navigate]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (!authenticated) return null;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">trading-terminal</h1>
      <p className="text-sm text-muted-foreground">Authenticated.</p>
      <div className="mt-4 flex gap-2">
        <a className="rounded-md border px-3 py-1 text-sm" href="/settings/credentials">API Credentials</a>
        <button
          type="button"
          className="rounded-md border px-3 py-1 text-sm"
          onClick={() => navigate({ to: "/markets/$symbol", params: { symbol: "BTCUSDT" } })}
        >
          Open BTCUSDT Market
        </button>
        <button
          type="button"
          className="rounded-md border px-3 py-1 text-sm"
          onClick={async () => {
            await logout();
            navigate({ to: "/login" });
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}
