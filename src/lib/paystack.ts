import crypto from "node:crypto";
import { fetchRetry } from "./http";
import { getSettings } from "./settings";

export class PaystackError extends Error {}

export type PsMode = "test" | "live";

export async function psContext(): Promise<{ secret: string; mode: PsMode }> {
  const s = await getSettings(["paystack_secret", "paystack_mode"]);
  if (!s.paystack_secret) throw new PaystackError("Paystack secret key is not set (Settings → API keys).");
  const keyMode = s.paystack_secret.startsWith("sk_live_") ? "live" : s.paystack_secret.startsWith("sk_test_") ? "test" : "";
  if (!keyMode) throw new PaystackError("The saved Paystack key is not a secret key (it should start with sk_test_ or sk_live_).");
  if (keyMode !== s.paystack_mode) {
    throw new PaystackError(
      `Paystack mode mismatch: the app is in ${s.paystack_mode.toUpperCase()} mode but the saved key is a ${keyMode.toUpperCase()} key. Switch the mode or save the matching key.`,
    );
  }
  return { secret: s.paystack_secret, mode: keyMode };
}

function friendly(message: string, mode: PsMode) {
  if (/activate|not.*verified|business.*(not|un)|go live|live mode|unverified/i.test(message)) {
    return `Paystack: your account is not yet verified/activated for ${mode} payments (“${message}”). Finish business verification in the Paystack dashboard, or use Test mode.`;
  }
  if (/invalid key|unauthori/i.test(message)) return `Paystack rejected the secret key (“${message}”). Check the key in Settings.`;
  return `Paystack: ${message}`;
}

async function ps<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { secret, mode } = await psContext();
  const res = await fetchRetry(
    `https://api.paystack.co${path}`,
    {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    },
    { timeoutMs: 25000, retries: init.method === "POST" ? 1 : 3 },
  );
  let j: { status?: boolean; message?: string; data?: T; meta?: { next?: string } } = {};
  try {
    j = await res.json();
  } catch {
    throw new PaystackError(`Paystack returned an unreadable response (HTTP ${res.status})`);
  }
  if (!res.ok || !j.status) throw new PaystackError(friendly(j.message || `HTTP ${res.status}`, mode));
  return j.data as T;
}

export type Bank = { name: string; code: string };
let bankCache: { at: number; banks: Bank[] } | null = null;

export async function listBanks(): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.at < 6 * 3600e3) return bankCache.banks;
  const data = await ps<{ name: string; code: string; active?: boolean }[]>("/bank?country=nigeria&perPage=200");
  const seen = new Set<string>();
  const banks = data
    .filter((b) => b.active !== false)
    .map((b) => ({ name: b.name, code: b.code }))
    .filter((b) => (seen.has(b.code) ? false : (seen.add(b.code), true)))
    .sort((a, b) => a.name.localeCompare(b.name));
  bankCache = { at: Date.now(), banks };
  return banks;
}

export async function resolveAccount(accountNumber: string, bankCode: string) {
  return ps<{ account_number: string; account_name: string }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );
}

export async function createSubaccount(p: { business_name: string; bank_code: string; account_number: string }) {
  return ps<{ subaccount_code: string }>("/subaccount", {
    method: "POST",
    body: {
      business_name: p.business_name,
      settlement_bank: p.bank_code,
      account_number: p.account_number,
      percentage_charge: 0,
      description: "SiteReach payout account",
    },
  });
}

export async function initTransaction(p: { email: string; amountKobo: number; reference: string; subaccount: string; metadata: Record<string, unknown> }) {
  return ps<{ authorization_url: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: {
      email: p.email,
      amount: p.amountKobo,
      currency: "NGN",
      reference: p.reference,
      subaccount: p.subaccount,
      bearer: "subaccount",
      metadata: p.metadata,
    },
  });
}

export async function verifyTransaction(reference: string) {
  return ps<{ status: string; amount: number; currency: string; reference: string }>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

export function verifySignature(raw: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const calc = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  const a = Buffer.from(calc);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
