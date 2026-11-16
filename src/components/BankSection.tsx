"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

type Sub = { code: string; bank_name: string; last4: string; account_name: string } | null;
type Props = {
  sub: { test: Sub; live: Sub };
  pending: { account_name: string; bank_name: string; last4: string } | null;
  mode: string;
  onChange: () => void;
};

export default function BankSection({ sub, pending, mode, onChange }: Props) {
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [bankErr, setBankErr] = useState("");
  const [bank, setBank] = useState("");
  const [acct, setAcct] = useState("");
  const [found, setFound] = useState<{ account_name: string; bank_name: string; last4: string } | null>(pending);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function loadBanks() {
    setBankErr("");
    try {
      const r = (await api("paystack/banks")) as { banks: { name: string; code: string }[] };
      setBanks(r.banks);
    } catch (e) {
      setBankErr(e instanceof Error ? e.message : "Could not load banks");
    }
  }
  useEffect(() => {
    loadBanks();
  }, []);

  async function resolve() {
    setBusy(true);
    setMsg(null);
    try {
      const r = (await api("paystack/resolve", { bank_code: bank, account_number: acct })) as { account_name: string; bank_name: string; last4: string };
      setFound(r);
      setAcct("");
    } catch (e) {
      setFound(null);
      setMsg({ ok: false, t: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setMsg(null);
    try {
      await api("paystack/confirm", {});
      setFound(null);
      setMsg({ ok: true, t: "Payout account confirmed and subaccount created." });
      onChange();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }
  async function reject() {
    await api("paystack/reject", {}).catch(() => {});
    setFound(null);
  }

  const cur = mode === "live" ? sub.live : sub.test;
  return (
    <div>
      <div className="rounded border border-line bg-white p-3 text-sm">
        <div className="font-semibold">Active payout account ({mode} mode)</div>
        {cur ? (
          <div className="mt-1">
            {cur.account_name} · {cur.bank_name} · ••••{cur.last4}
            <div className="text-xs text-emerald-800">Subaccount ready</div>
          </div>
        ) : (
          <div className="mt-1 text-amber-800">None yet. Add and confirm one below. Test and Live modes each need their own.</div>
        )}
      </div>

      <label className="label">Bank</label>
      <select className="field" value={bank} onChange={(e) => setBank(e.target.value)}>
        <option value="">{banks.length ? "Select your bank" : "Loading banks…"}</option>
        {banks.map((b) => (
          <option key={b.code} value={b.code}>
            {b.name}
          </option>
        ))}
      </select>
      {bankErr && (
        <div className="mt-1 text-xs text-red-700">
          {bankErr}{" "}
          <button className="underline" onClick={loadBanks}>
            Retry
          </button>
        </div>
      )}
      <label className="label">Account number (10 digits)</label>
      <input className="field" inputMode="numeric" maxLength={10} value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ""))} autoComplete="off" />
      <button type="button" className="btn mt-3" disabled={busy || !bank || acct.length !== 10} onClick={resolve}>
        {busy && !found ? "Checking…" : "Save & verify account"}
      </button>

      {found && (
        <div className="mt-3 rounded border-2 border-gold bg-white p-3">
          <div className="text-xs text-slate-600">Paystack returned this account name:</div>
          <div className="text-lg font-bold">{found.account_name}</div>
          <div className="text-sm">
            {found.bank_name} · ••••{found.last4}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-gold" disabled={busy} onClick={confirm}>
              {busy ? "Creating…" : "Yes, this is my account"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={reject}>
              No
            </button>
          </div>
        </div>
      )}
      {msg && <div className={`mt-2 text-sm ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.t}</div>}
    </div>
  );
}
