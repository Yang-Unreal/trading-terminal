import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { listCredentials, createCredential, updateCredential, deleteCredential, type CredentialMeta } from "@/features/credentials/credentials.api";

export const Route = createFileRoute("/settings/credentials")({
  component: CredentialsPage,
});

function CredentialsPage() {
  const { loading, authenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<CredentialMeta[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !authenticated) navigate({ to: "/login" });
  }, [loading, authenticated, navigate]);

  const refresh = async () => {
    setLoadingList(true);
    try {
      setItems(await listCredentials());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (authenticated) refresh();
  }, [authenticated]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (!authenticated) return null;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Exchange API Credentials</h1>
        <button className="rounded-md bg-primary text-primary-foreground px-3 py-1 text-sm" onClick={() => setShowAdd(true)}>Add Credential</button>
      </div>
      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
      {loadingList ? (
        <p>Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No credentials saved.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.id} className="border rounded-md p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{c.exchange} — {c.label}</div>
                <div className="text-xs text-muted-foreground">Key hint: {c.api_key_hint ?? "—"} · {c.is_active ? "Active" : "Disabled"} · {new Date(c.created_at).toLocaleString()}</div>
              </div>
              <div className="flex gap-2">
                <button
                  className="text-sm border rounded px-2 py-1"
                  onClick={async () => {
                    await updateCredential(c.id, { is_active: !c.is_active });
                    refresh();
                  }}
                >
                  {c.is_active ? "Disable" : "Enable"}
                </button>
                <button
                  className="text-sm border rounded px-2 py-1"
                  onClick={async () => {
                    const label = prompt("New label", c.label);
                    if (label) {
                      await updateCredential(c.id, { label });
                      refresh();
                    }
                  }}
                >
                  Edit
                </button>
                <button
                  className="text-sm border rounded px-2 py-1 text-red-500"
                  onClick={async () => {
                    if (confirm("Delete credential?")) {
                      await deleteCredential(c.id);
                      refresh();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {showAdd && (
        <AddDialog
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AddDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [exchange] = useState("bitget");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !apiKey || !apiSecret || !passphrase) {
      setErr("All fields required");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createCredential({ exchange, label, api_key: apiKey, api_secret: apiSecret, passphrase });
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-background border rounded-md p-6 w-full max-w-md space-y-3">
        <h2 className="text-lg font-semibold">Add Credential</h2>
        {err && <p className="text-sm text-red-500">{err}</p>}
        <input className="w-full border rounded px-2 py-1" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className="w-full border rounded px-2 py-1" value={exchange} disabled>
          <option value="bitget">Bitget</option>
        </select>
        <input className="w-full border rounded px-2 py-1" placeholder="API Key" type={show ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <input className="w-full border rounded px-2 py-1" placeholder="API Secret" type={show ? "text" : "password"} value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
        <input className="w-full border rounded px-2 py-1" placeholder="Passphrase" type={show ? "text" : "password"} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="border rounded px-3 py-1 text-sm" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={submitting} className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm">{submitting ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
