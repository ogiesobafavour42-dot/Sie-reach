"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";

export default function Login() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ authed: boolean; configured: boolean }>("session")
      .then((s) => {
        if (s.authed) window.location.href = "/";
        else setConfigured(s.configured);
      })
      .catch((e) => setErr(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!configured && pw !== pw2) return setErr("Passwords do not match");
    setBusy(true);
    try {
      await api(configured ? "login" : "setup", { password: pw });
      window.location.href = "/";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-4xl font-bold">SiteReach</h1>
      <p className="mt-1 text-sm text-slate-600">Owner dashboard</p>
      {configured === null && !err && <p className="mt-6 text-sm">Loading…</p>}
      {configured !== null && (
        <form onSubmit={submit} className="mt-6">
          {!configured && <p className="mb-2 rounded bg-amber-100 p-2 text-xs text-amber-900">First run: choose the owner password now. Only one owner account exists.</p>}
          <label className="label">{configured ? "Password" : "Create password (8+ characters)"}</label>
          <input className="field" type="password" autoComplete={configured ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} required />
          {!configured && (
            <>
              <label className="label">Repeat password</label>
              <input className="field" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            </>
          )}
          <button className="btn mt-4 w-full" disabled={busy}>
            {busy ? "Please wait…" : configured ? "Sign in" : "Create account"}
          </button>
        </form>
      )}
      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
    </main>
  );
}
