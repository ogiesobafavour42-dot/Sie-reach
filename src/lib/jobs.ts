import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, messages, sites } from "@/db/schema";
import { findLeads } from "./leadfinder";
import { generateSite } from "./sitegen";
import { hasPitch, writePitch } from "./pitch";
import { isBlocked, runSender } from "./mailer";
import { checkInbox } from "./inbox";
import { getSettings, setSetting } from "./settings";
import { errMsg, log } from "./log";

const g = globalThis as typeof globalThis & { __srRunning?: Set<string>; __srWarned?: Map<string, number> };
const running = (g.__srRunning ??= new Set<string>());
const warned = (g.__srWarned ??= new Map<string, number>());

export async function runJob(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  if (running.has(name)) return false;
  running.add(name);
  try {
    await fn();
  } catch (e) {
    await log("error", name, errMsg(e));
  } finally {
    running.delete(name);
  }
  return true;
}

export function isRunning(name: string) {
  return running.has(name);
}

async function warnOnce(key: string, msg: string) {
  if (Date.now() - (warned.get(key) ?? 0) < 3600e3) return;
  warned.set(key, Date.now());
  await log("warn", key, msg);
}

async function sitesJob() {
  const s = await getSettings(["gemini_key", "netlify_token"]);
  if (!s.gemini_key || !s.netlify_token) return warnOnce("sites", "Site generation skipped: Gemini key and Netlify token are needed (Settings).");
  const cands = await db.select().from(leads).where(and(eq(leads.status, "new"), isNotNull(leads.email), isNull(leads.previewUrl))).orderBy(asc(leads.id)).limit(30);
  const existing = await db.select().from(sites).where(eq(sites.kind, "sample"));
  const map = new Map(existing.map((x) => [x.leadId, x]));
  let done = 0;
  for (const l of cands) {
    if (done >= 2) break;
    const st = map.get(l.id);
    if (st && (st.attempts >= 3 || st.status === "building")) continue;
    if (l.email && (await isBlocked(l.email))) continue;
    done++;
    try {
      await generateSite(l.id, "sample");
    } catch {
      /* logged */
    }
  }
}

async function pitchJob() {
  const s = await getSettings(["gemini_key"]);
  if (!s.gemini_key) return warnOnce("pitch", "Pitch writer skipped: Gemini key not set.");
  const pending = (await db.select({ c: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.status, "pending"), eq(messages.kind, "pitch"))))[0].c;
  if (pending >= 30) return;
  const cands = await db.select().from(leads).where(and(eq(leads.status, "new"), isNotNull(leads.email), isNotNull(leads.previewUrl))).orderBy(asc(leads.id)).limit(30);
  let done = 0;
  for (const l of cands) {
    if (done >= 5) break;
    if (!l.email || (await isBlocked(l.email)) || (await hasPitch(l.id))) continue;
    done++;
    try {
      await writePitch(l.id);
    } catch (e) {
      await log("error", "pitch", `${l.name}: ${errMsg(e)}`);
    }
  }
  const s2 = await getSettings(["manual_approve"]);
  if (done && s2.manual_approve !== "1") kick("send");
}

export const JOBS = {
  leads: async () => {
    await findLeads();
  },
  sites: sitesJob,
  pitch: pitchJob,
  send: runSender,
  inbox: async () => {
    await checkInbox();
  },
} as const;

export type JobName = keyof typeof JOBS;

export function kick(name: JobName) {
  void runJob(name, async () => {
    await JOBS[name]();
    await setSetting(`lastrun_${name}`, String(Date.now()), false).catch(() => {});
  });
}

export const SCHEDULE: { name: JobName; toggle: string; everyMin: number }[] = [
  { name: "leads", toggle: "auto_leads", everyMin: 360 },
  { name: "sites", toggle: "auto_sites", everyMin: 8 },
  { name: "pitch", toggle: "auto_pitch", everyMin: 8 },
  { name: "send", toggle: "auto_send", everyMin: 5 },
  { name: "inbox", toggle: "auto_inbox", everyMin: 7 },
];
