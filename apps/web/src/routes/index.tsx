import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

type Item = { id: number; name: string };

function HomeComponent() {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const base = "http://127.0.0.1:3000";

  const refresh = async () => {
    const r = await fetch(`${base}/items`);
    setItems(await r.json());
  };

  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    await fetch(`${base}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setName("");
    refresh();
  };

  const saveEdit = async () => {
    if (!editing) return;
    await fetch(`${base}/items/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editing.name }) });
    setEditing(null);
    refresh();
  };

  const del = async (id: number) => {
    await fetch(`${base}/items/${id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">CRUD Demo (DB)</h1>
      <div className="flex gap-2 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} className="border px-2 py-1" />
        <button onClick={add} className="border px-3 py-1">Add</button>
        <button onClick={refresh} className="border px-3 py-1">Refresh</button>
      </div>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id} className="flex gap-2 items-center">
            {editing?.id === i.id ? (
              <>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="border px-2 py-1" />
                <button onClick={saveEdit} className="border px-2 py-1 text-sm">Save</button>
                <button onClick={() => setEditing(null)} className="border px-2 py-1 text-sm">Cancel</button>
              </>
            ) : (
              <>
                <span>{i.id}: {i.name}</span>
                <button onClick={() => setEditing(i)} className="border px-2 py-1 text-sm">Edit</button>
                <button onClick={() => del(i.id)} className="border px-2 py-1 text-sm">Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
