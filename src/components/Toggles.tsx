"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function SettingToggle({ k, label, hint, on: initial }: { k: string; label: string; hint?: string; on: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function flip() {
    const next = !on;
    setOn(next);
    setBusy(true);
    setErr("");
    try {
      await api("toggle", { key: k, on: next });
      router.refresh();
    } catch (e) {
      setOn(!next);
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-xs text-slate-600">{hint}</div>}
        {err && <div className="text-xs text-red-700">{err}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        onClick={flip}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${on ? "border-navy bg-navy" : "border-line bg-slate-200"}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export function KillSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!on && !window.confirm("Stop ALL email sending immediately?")) return;
    setBusy(true);
    try {
      await api("killswitch", { on: !on });
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={go} disabled={busy} className={`rounded px-3 py-1.5 text-xs font-bold ${on ? "bg-white text-red-700" : "bg-red-700 text-white"}`}>
      {on ? "Resume sending" : "KILL SWITCH"}
    </button>
  );
}
