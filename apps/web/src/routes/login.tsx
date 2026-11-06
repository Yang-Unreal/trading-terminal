import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  component: LoginComponent,
});

function LoginComponent() {
  const { login, authenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!loading && authenticated) {
    navigate({ to: "/" });
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
      navigate({ to: "/" });
    } catch {
      setError("Invalid credentials");
    }
  };

  return (
    <div className="container mx-auto max-w-sm px-4 py-20">
      <h1 className="text-2xl font-semibold mb-4">Login</h1>
      <form onSubmit={submit} className="space-y-3">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="border px-2 py-1 w-full" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="border px-2 py-1 w-full" />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button type="submit" className="border px-3 py-1 w-full">Login</button>
      </form>
    </div>
  );
}
