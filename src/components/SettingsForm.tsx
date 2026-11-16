"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { SettingToggle } from "./Toggles";
import BankSection from "./BankSection";
import PushSetup from "./PushSetup";

type Data = {
  values: Record<string, string>;
  secrets: Record<string, boolean>;
  keyMode: string;
  manualLast4: string;
  sub: { test: null | { code: string; bank_name: string; last4: string; account_name: string }; live: null | { code: string; bank_name: string; last4: string; account_name: string } };
  pending: null | { account_name: string; bank_name: string; last4: string };
  webhookUrl: string;
};

const SECRET_FIELDS: { k: string; label: string; hint?: string }[] = [
  { k: "gemini_key", label: "Gemini API key", hint: "From Google AI Studio" },
  { k: "gmail_app_password", label: "Gmail app password", hint: "16 characters, from Google Account → Security → App passwords" },
  { k: "netlify_token", label: "Netlify personal access token", hint: "Netlify → User settings → Applications" },
  { k: "paystack_secret", label: "Paystack secret key", hint: "sk_test_… for Test mode, sk_live_… for Live mode" },
];

export default function SettingsForm() {
  const [d, setD] = useState<Data | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [manualNum, setManualNum] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState("");

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const r = (await api("settings")) as unknown as Data;
      setD(r);
      setV(r.values);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (loadErr)
    return (
      <div className="card text-sm text-red-700">
        {loadErr} <button className="underline" onClick={load}>Retry</button>
      </div>
    );
  if (!d) return <p className="text-sm">Loading settings…</p>;

  const set = (k: string, val: string) => setV((o) => ({ ...o, [k]: val }));
  const text = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label">{label}</label>
      <input className="field" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  );

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const values: Record<string, string> = {};
      for (const k of ["niche", "city", "daily_limit", "tone", "price", "deposit_percent", "owner_name", "owner_phone", "payment_mode", "paystack_mode", "gemini_model", "gmail_user", "manual_bank_name", "manual_account_name", "max_leads_per_run"]) values[k] = v[k] ?? "";
      for (const [k, s] of Object.entries(secrets)) if (s) values[k] = s;
      if (manualNum) values.manual_account_number = manualNum;
      await api("settings", { values });
      setSecrets({});
      setManualNum("");
      setMsg({ ok: true, t: "Saved." });
      await load();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  const on = (k: string) => v[k] === "1";
  const sec = (k: string) => (d.secrets[k] ? "Saved ✓ (type to replace)" : "Not set");

  return (
    <div className="space-y-4 pb-24">
      <section className="card">
        <h2 className="text-xl font-bold">Business</h2>
        {text("owner_name", "Your name")}
        {text("owner_phone", "Your phone (appears in emails)", { inputMode: "tel" })}
        {/\[MY PHONE\]/i.test(v.owner_phone ?? "") && <p className="mt-1 text-xs text-red-700">Replace [MY PHONE] with your real number or sending stays blocked.</p>}
        {text("niche", "Niche (e.g. private schools, restaurants, clinics)")}
        {text("city", "City")}
        {text("max_leads_per_run", "New leads per run", { inputMode: "numeric" })}
        {text("daily_limit", "Daily email limit (max 20)", { inputMode: "numeric" })}
        {text("tone", "Email tone")}
        {text("price", "Website price (NGN)", { inputMode: "numeric" })}
        {text("deposit_percent", "Deposit (% of price)", { inputMode: "numeric" })}
      </section>

      <section className="card">
        <h2 className="text-xl font-bold">Automation</h2>
        <SettingToggle k="manual_approve" label="Manual approve" hint="ON: every pitch/reply waits in the Approval Queue. OFF: fully automatic." on={on("manual_approve")} />
        <SettingToggle k="auto_leads" label="Lead finder" on={on("auto_leads")} />
        <SettingToggle k="auto_sites" label="Site generation" on={on("auto_sites")} />
        <SettingToggle k="auto_pitch" label="Pitch writer" on={on("auto_pitch")} />
        <SettingToggle k="auto_send" label="Sender" on={on("auto_send")} />
        <SettingToggle k="auto_inbox" label="Inbox check + AI replies" on={on("auto_inbox")} />
        <SettingToggle k="notify_push" label="Push notifications" on={on("notify_push")} />
      </section>

      <section className="card">
        <h2 className="text-xl font-bold">API keys</h2>
        <p className="text-xs text-slate-600">Stored encrypted on the server. They are never shown again, only “Saved”.</p>
        {text("gemini_model", "Gemini model")}
        {text("gmail_user", "Gmail address", { type: "email", inputMode: "email" })}
        {SECRET_FIELDS.map((f) => (
          <div key={f.k}>
            <label className="label">{f.label}</label>
            <input className="field" type="password" autoComplete="off" placeholder={sec(f.k)} value={secrets[f.k] ?? ""} onChange={(e) => setSecrets({ ...secrets, [f.k]: e.target.value })} />
            {f.hint && <p className="mt-0.5 text-xs text-slate-500">{f.hint}</p>}
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="text-xl font-bold">Payments</h2>
        <label className="label">Payment mode</label>
        <select className="field" value={v.payment_mode} onChange={(e) => set("payment_mode", e.target.value)}>
          <option value="paystack">Paystack (automatic)</option>
          <option value="manual">Manual bank transfer</option>
        </select>

        {v.payment_mode === "paystack" ? (
          <>
            <label className="label">Paystack mode</label>
            <select className="field" value={v.paystack_mode} onChange={(e) => set("paystack_mode", e.target.value)}>
              <option value="test">Test (no real money)</option>
              <option value="live">Live (real money)</option>
            </select>
            {d.keyMode && d.keyMode !== "invalid" && d.keyMode !== v.paystack_mode && <p className="mt-1 text-xs text-red-700">Saved key is a {d.keyMode} key but mode is {v.paystack_mode}. Save the matching key.</p>}
            {!d.secrets.paystack_secret && <p className="mt-1 text-xs text-amber-800">Save your Paystack secret key above first, then tap Save at the bottom.</p>}
            <p className="mt-3 text-xs">
              Webhook URL (paste in Paystack → Settings → API Keys &amp; Webhooks, for the matching mode):
              <code className="mt-1 block break-all rounded bg-white p-2">{d.webhookUrl}</code>
            </p>
            <h3 className="mt-5 font-serif text-lg font-bold">Payout bank</h3>
            <p className="text-xs text-slate-600">Money settles directly to this account through a Paystack subaccount (0% platform share). Save settings first if you just changed the key or mode.</p>
            <BankSection sub={d.sub} pending={d.pending} mode={v.paystack_mode} onChange={load} />
          </>
        ) : (
          <>
            <h3 className="mt-4 font-serif text-lg font-bold">Manual bank transfer details</h3>
            <p className="text-xs text-slate-600">Sent to clients in the reply.</p>
            {text("manual_bank_name", "Bank name")}
            {text("manual_account_name", "Account name")}
            <label className="label">Account number {d.manualLast4 && <span className="font-normal">(saved: ••••{d.manualLast4})</span>}</label>
            <input className="field" inputMode="numeric" maxLength={10} autoComplete="off" placeholder={d.manualLast4 ? "Type to replace" : "10 digits"} value={manualNum} onChange={(e) => setManualNum(e.target.value.replace(/\D/g, ""))} />
          </>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-14 z-10 border-t border-line bg-ivory/95 p-3">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <button className="btn flex-1" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
        {msg && <p className={`mx-auto mt-1 max-w-xl text-center text-xs ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.t}</p>}
      </div>

      <section className="card">
        <h2 className="text-xl font-bold">Push notifications</h2>
        <PushSetup />
      </section>

      <section className="card">
        <h2 className="text-xl font-bold">Account</h2>
        <label className="label">Current password</label>
        <input className="field" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
        <label className="label">New password</label>
        <input className="field" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
        <div className="mt-3 flex gap-2">
          <button
            className="btn btn-ghost"
            onClick={async () => {
              try {
                await api("password", pw);
                setPw({ current: "", next: "" });
                setPwMsg("Password changed");
              } catch (e) {
                setPwMsg(e instanceof Error ? e.message : "Failed");
              }
            }}
          >
            Change password
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              await api("logout", {}).catch(() => {});
              window.location.href = "/login";
            }}
          >
            Sign out
          </button>
        </div>
        {pwMsg && <p className="mt-2 text-xs">{pwMsg}</p>}
      </section>
    </div>
  );
}
