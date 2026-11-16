import nodemailer from "nodemailer";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { blocklist, leads, messages } from "@/db/schema";
import { getBool, getSettings } from "./settings";
import { errMsg, log } from "./log";
import { sleep } from "./http";
import { OPT_OUT } from "./pitch";

export const HARD_CAP = 20;

export function lagosDayStart(): Date {
  const lagosNow = new Date(Date.now() + 3600e3);
  const d = new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate()));
  return new Date(d.getTime() - 3600e3);
}

export async function sentToday(): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.direction, "out"), eq(messages.status, "sent"), gte(messages.sentAt, lagosDayStart())));
  return r[0].c;
}

export async function isBlocked(email: string) {
  const r = await db.select().from(blocklist).where(eq(blocklist.email, email.toLowerCase()));
  return r.length > 0;
}

export async function block(email: string, reason: string) {
  await db.insert(blocklist).values({ email: email.toLowerCase(), reason }).onConflictDoNothing();
  // cancel anything queued for this address
  await db
    .update(messages)
    .set({ status: "rejected", error: "Blocked (STOP)" })
    .where(and(eq(messages.toEmail, email.toLowerCase()), sql`${messages.status} in ('pending','approved')`));
  await db.update(leads).set({ status: "dead" }).where(eq(leads.email, email.toLowerCase()));
}

function transport(user: string, pass: string) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 40000,
  });
}

let lastSendAt = 0;
let nextDelay = 0;

export async function runSender(): Promise<void> {
  for (let guard = 0; guard < 50; guard++) {
    if (await getBool("kill_switch")) {
      await log("warn", "send", "Kill switch is ON: sending stopped");
      return;
    }
    const next = (await db.select().from(messages).where(and(eq(messages.direction, "out"), eq(messages.status, "approved"))).orderBy(asc(messages.id)).limit(1))[0];
    if (!next) return;

    const s = await getSettings(["gmail_user", "gmail_app_password", "daily_limit", "owner_name", "owner_phone"]);
    if (!s.gmail_user || !s.gmail_app_password) {
      await log("warn", "send", "Gmail address / app password not set: nothing sent");
      return;
    }
    if (/\[MY PHONE\]/i.test(s.owner_phone)) {
      await log("error", "send", "Set your phone number in Settings before sending emails");
      return;
    }
    const cap = Math.min(HARD_CAP, Math.max(1, parseInt(s.daily_limit) || HARD_CAP));
    if ((await sentToday()) >= cap) {
      await log("warn", "send", `Daily cap of ${cap} reached: remaining emails wait until tomorrow`);
      return;
    }
    const to = (next.toEmail || "").toLowerCase();
    if (!to || (await isBlocked(to))) {
      await db.update(messages).set({ status: "rejected", error: "Blocked or missing address" }).where(eq(messages.id, next.id));
      await log("warn", "send", `Skipped ${to || "(no address)"}: blocklisted`);
      continue;
    }
    if (next.kind === "pitch") {
      const dup = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.direction, "out"), eq(messages.kind, "pitch"), eq(messages.status, "sent"), eq(messages.toEmail, to)));
      if (dup.length) {
        await db.update(messages).set({ status: "rejected", error: "Already emailed this address" }).where(eq(messages.id, next.id));
        await log("warn", "send", `Skipped duplicate pitch to ${to}`);
        continue;
      }
    }

    // random human-like delay between sends
    if (lastSendAt) {
      const wait = nextDelay - (Date.now() - lastSendAt);
      if (wait > 0) await sleep(wait);
    }
    if (await getBool("kill_switch")) return;

    let text = next.body;
    if (!text.includes(OPT_OUT)) text += `\n\n${OPT_OUT}`;
    let inReplyTo: string | undefined;
    if (next.replyToId) {
      const parent = (await db.select().from(messages).where(eq(messages.id, next.replyToId)))[0];
      inReplyTo = parent?.messageId || undefined;
    }
    try {
      const info = await transport(s.gmail_user, s.gmail_app_password).sendMail({
        from: `"${s.owner_name}" <${s.gmail_user}>`,
        to,
        subject: next.subject,
        text,
        headers: { "List-Unsubscribe": `<mailto:${s.gmail_user}?subject=STOP>` },
        ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
      });
      await db.update(messages).set({ status: "sent", sentAt: new Date(), messageId: info.messageId, fromEmail: s.gmail_user, body: text, error: null }).where(eq(messages.id, next.id));
      if (next.kind === "pitch") await db.update(leads).set({ status: "pitched" }).where(and(eq(leads.id, next.leadId), eq(leads.status, "new")));
      await log("info", "send", `Sent ${next.kind} to ${to}: "${next.subject.slice(0, 60)}"`);
      lastSendAt = Date.now();
      nextDelay = 25000 + Math.floor(Math.random() * 65000);
    } catch (e) {
      await db.update(messages).set({ status: "failed", error: errMsg(e).slice(0, 300) }).where(eq(messages.id, next.id));
      await log("error", "send", `Send to ${to} failed: ${errMsg(e)}`);
    }
  }
}
