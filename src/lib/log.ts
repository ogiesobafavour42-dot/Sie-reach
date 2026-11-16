import { db } from "@/db";
import { activity } from "@/db/schema";
import { notify } from "./push";

export function scrub(s: string) {
  return s
    .replace(/AIza[\w-]{25,}/g, "[key]")
    .replace(/sk_(test|live)_\w+/g, "[key]")
    .replace(/pk_(test|live)_\w+/g, "[key]")
    .replace(/Bearer\s+[\w.-]+/g, "Bearer [key]");
}

export function errMsg(e: unknown) {
  return scrub(e instanceof Error ? e.message : String(e));
}

const lastErrPush = new Map<string, number>();

export async function log(level: "info" | "warn" | "error", type: string, message: string) {
  const m = scrub(message).slice(0, 1500);
  console.log(`[${level}] ${type}: ${m}`);
  try {
    await db.insert(activity).values({ level, type, message: m });
  } catch {
    /* never throw from logger */
  }
  if (level === "error") {
    const last = lastErrPush.get(type) ?? 0;
    if (Date.now() - last > 10 * 60 * 1000) {
      lastErrPush.set(type, Date.now());
      await notify("SiteReach error", `${type}: ${m.slice(0, 120)}`, "/activity").catch(() => {});
    }
  }
}
