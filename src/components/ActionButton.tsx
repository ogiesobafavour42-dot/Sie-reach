"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiResult } from "./api";

type Props = {
  label: string;
  path: string;
  body?: unknown;
  confirm?: string;
  variant?: "primary" | "ghost" | "gold" | "danger";
  small?: boolean;
  refresh?: boolean;
  className?: string;
  redirect?: string;
};

export default function ActionButton({ label, path, body, confirm, variant = "primary", small, refresh = true, className = "", redirect }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; extra?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function go() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r: ApiResult = await api(path, body ?? {});
      setMsg({ ok: true, text: r.message || "Done", extra: r.text });
      if (redirect) router.push(redirect);
      else if (refresh) router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  const cls = `btn ${variant === "ghost" ? "btn-ghost" : variant === "gold" ? "btn-gold" : variant === "danger" ? "btn-danger" : ""} ${small ? "btn-sm" : ""}`;
  return (
    <span className={`inline-block ${className}`}>
      <button type="button" className={cls} disabled={busy} onClick={go}>
        {busy ? "Working…" : label}
      </button>
      {msg && (
        <span className={`mt-1 block text-xs ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>
          {msg.text}
          {msg.extra && (
            <span className="mt-1 block">
              <span className="block whitespace-pre-wrap rounded border border-line bg-white p-2 text-sm text-navy">{msg.extra}</span>
              <button
                type="button"
                className="mt-1 underline"
                onClick={() => {
                  navigator.clipboard?.writeText(msg.extra ?? "").then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
