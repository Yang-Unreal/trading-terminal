export type CredentialMeta = {
  id: string;
  exchange: string;
  label: string;
  api_key_hint: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateCredentialInput = {
  exchange: string;
  label: string;
  api_key: string;
  api_secret: string;
  passphrase: string;
};

const BASE = "http://localhost:3000";

async function csrfToken(): Promise<string> {
  const r = await fetch(`${BASE}/auth/csrf`, { credentials: "include" });
  const d = await r.json();
  return d.csrf_token as string;
}

export async function listCredentials(): Promise<CredentialMeta[]> {
  const r = await fetch(`${BASE}/api/credentials`, { credentials: "include" });
  if (!r.ok) throw new Error(`list failed ${r.status}`);
  return r.json();
}

export async function createCredential(input: CreateCredentialInput): Promise<CredentialMeta> {
  const token = await csrfToken();
  const r = await fetch(`${BASE}/api/credentials`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`create failed ${r.status}`);
  return r.json();
}

export async function updateCredential(id: string, patch: { label?: string; is_active?: boolean }): Promise<CredentialMeta> {
  const token = await csrfToken();
  const r = await fetch(`${BASE}/api/credentials/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`update failed ${r.status}`);
  return r.json();
}

export async function deleteCredential(id: string): Promise<void> {
  const token = await csrfToken();
  const r = await fetch(`${BASE}/api/credentials/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRF-Token": token },
  });
  if (!r.ok) throw new Error(`delete failed ${r.status}`);
}
