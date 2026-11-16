"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

type M = { id: number; kind: string; toEmail: string | null; subject: string; body: string; status: string; error: string | null };

export default function MessageCard({ m, leadName, sendLabel = "Approve & send" }: { m: M; leadName?: string; sendLabel?: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("message", { id: m.id, action, ...extra });
      setMsg({ ok: true, t: r.message || "Done" });
      if (action !== "edit") setEditing(false);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  const failed = m.status === "failed";
  return (
    <div className="card mt-2 border-l-4 border-l-gold">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-bold uppercase tracking-wide text-gold">{m.kind === "pitch" ? "Pitch" : "Reply draft"}{failed ? " · failed" : ""}</span>
        <span className="truncate text-slate-600">{leadName ? `${leadName} · ` : ""}{m.toEmail}</span>
      </div>
      {editing ? (
        <>
          <label className="label">Subject</label>
          <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label className="label">Message</label>
          <textarea className="field min-h-48" value={body} onChange={(e) => setBody(e.target.value)} />
        </>
      ) : (
        <>
          <div className="mt-2 text-sm font-semibold">{m.subject}</div>
          <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{m.body}</div>
        </>
      )}
      {m.error && <div className="mt-1 text-xs text-red-700">{m.error}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button className="btn btn-sm" disabled={busy} onClick={() => act("approve", { subject, body })}>
              Save & send
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("edit", { subject, body })}>
              Save only
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" disabled={busy} onClick={() => act(failed ? "retry" : "approve")}>
              {busy ? "Working…" : failed ? "Retry send" : sendLabel}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act("reject")}>
              Reject
            </button>
          </>
        )}
      </div>
      {msg && <div className={`mt-2 text-xs ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.t}</div>}
    </div>
  );
}
