"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function AddLead() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", website: "", phone: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await api("lead", { action: "add", ...f });
      setF({ name: "", email: "", website: "", phone: "" });
      setMsg("Lead added");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card mb-3">
      <summary className="cursor-pointer text-sm font-semibold">+ Add a lead manually (good for testing)</summary>
      {(["name", "email", "website", "phone"] as const).map((k) => (
        <div key={k}>
          <label className="label capitalize">{k}</label>
          <input className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} inputMode={k === "phone" ? "tel" : k === "email" ? "email" : "text"} />
        </div>
      ))}
      <button className="btn mt-3" disabled={busy || !f.name} onClick={save}>
        {busy ? "Saving…" : "Add lead"}
      </button>
      {msg && <div className="mt-2 text-xs">{msg}</div>}
    </details>
  );
}

export function StatusSelect({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <select
      className="field max-w-40"
      value={status}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        try {
          await api("lead", { action: "status", id, status: e.target.value });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {["new", "pitched", "replied", "interested", "paid", "dead"].map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );
}

export function CopyBox({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <pre className="whitespace-pre-wrap rounded border border-line bg-white p-2 text-sm">{text}</pre>
      <button className="btn btn-ghost btn-sm mt-1" onClick={() => navigator.clipboard?.writeText(text).then(() => setDone(true))}>
        {done ? "Copied" : label}
      </button>
    </div>
  );
}
