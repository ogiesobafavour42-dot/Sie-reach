import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";

export const SECRET_KEYS = [
  "gemini_key",
  "gmail_app_password",
  "netlify_token",
  "paystack_secret",
  "manual_account_number",
  "owner_password_hash",
  "vapid_private",
  "paystack_pending_account",
] as const;

export const DEFAULTS: Record<string, string> = {
  niche: "private schools",
  city: "Lagos",
  daily_limit: "20",
  tone: "friendly, calm and specific",
  price: "150000",
  deposit_percent: "50",
  owner_name: "TINITO",
  owner_phone: "[MY PHONE]",
  payment_mode: "paystack",
  paystack_mode: "test",
  manual_approve: "1",
  kill_switch: "0",
  auto_leads: "1",
  auto_sites: "1",
  auto_pitch: "1",
  auto_send: "1",
  auto_inbox: "1",
  notify_push: "1",
  gemini_model: "gemini-3.8-flash",
  gmail_user: "",
  manual_bank_name: "",
  manual_account_name: "",
  max_leads_per_run: "15",
};

export async function getSetting(key: string): Promise<string> {
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  const r = rows[0];
  if (!r) return DEFAULTS[key] ?? "";
  if (r.encrypted) {
    try {
      return await decrypt(r.value);
    } catch {
      return "";
    }
  }
  return r.value;
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = DEFAULTS[k] ?? "";
  for (const r of rows) {
    if (r.encrypted) {
      try {
        out[r.key] = await decrypt(r.value);
      } catch {
        out[r.key] = "";
      }
    } else out[r.key] = r.value;
  }
  return out;
}

export async function setSetting(key: string, value: string, encrypted?: boolean) {
  const enc = encrypted ?? (SECRET_KEYS as readonly string[]).includes(key);
  const stored = enc ? await encrypt(value) : value;
  await db
    .insert(settings)
    .values({ key, value: stored, encrypted: enc })
    .onConflictDoUpdate({ target: settings.key, set: { value: stored, encrypted: enc, updatedAt: new Date() } });
}

export async function deleteSetting(key: string) {
  await db.delete(settings).where(eq(settings.key, key));
}

export async function hasSetting(key: string): Promise<boolean> {
  const rows = await db.select({ k: settings.key }).from(settings).where(eq(settings.key, key));
  return rows.length > 0;
}

export async function getBool(key: string) {
  return (await getSetting(key)) === "1";
}

export function lastFour(s: string) {
  const d = s.replace(/\D/g, "");
  return d.slice(-4);
}
