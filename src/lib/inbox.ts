import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { leads, messages } from "@/db/schema";
import { geminiJson } from "./gemini";
import { getSettings } from "./settings";
import { errMsg, log } from "./log";
import { notify } from "./push";
import { block } from "./mailer";
import { signature } from "./pitch";
import { paymentInfoText } from "./closing";
import { kick } from "./jobs";

type Raw = { messageId: string; from: string; subject: string; text: string; inReplyTo?: string; date: Date };

export function cleanReply(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^>/.test(l)) break;
    if (/^On .+wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From:\s.+/i.test(l) && out.length > 2) break;
    if (/^On .+/i.test(l) && /wrote:?$/i.test(lines[lines.indexOf(l) + 1] ?? "")) break;
    out.push(l);
  }
  return out.join("\n").trim().slice(0, 4000);
}

const STOP_RE = /^\W*(stop|unsubscribe|opt[\s-]*out|remove me|remove|cancel)\b|\b(stop emailing|do not email|don'?t email|unsubscribe me|reply stop)\b/i;

export function looksLikeStop(body: string) {
  const b = body.trim();
  return b.length <= 200 && STOP_RE.test(b);
}

async function fetchNew(): Promise<Raw[]> {
  const s = await getSettings(["gmail_user", "gmail_app_password"]);
  if (!s.gmail_user || !s.gmail_app_password) {
    await log("warn", "inbox", "Gmail not configured: inbox check skipped");
    return [];
  }
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: s.gmail_user, pass: s.gmail_app_password },
    logger: false,
    socketTimeout: 60000,
    greetingTimeout: 20000,
    connectionTimeout: 20000,
  });
  client.on("error", () => {});
  const out: Raw[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 4 * 86400e3);
      const uids = ((await client.search({ since }, { uid: true })) || []).slice(-60);
      const env: { uid: number; id: string }[] = [];
      if (uids.length) {
        for await (const m of client.fetch(uids, { envelope: true }, { uid: true })) {
          if (m.envelope?.messageId) env.push({ uid: m.uid, id: m.envelope.messageId });
        }
      }
      const known = env.length ? await db.select({ id: messages.messageId }).from(messages).where(inArray(messages.messageId, env.map((e) => e.id))) : [];
      const knownSet = new Set(known.map((k) => k.id));
      for (const e of env.filter((x) => !knownSet.has(x.id)).slice(-25)) {
        const m = await client.fetchOne(String(e.uid), { source: true }, { uid: true });
        if (!m || !m.source) continue;
        const p = await simpleParser(m.source);
        const from = p.from?.value?.[0]?.address?.toLowerCase();
        if (!from || from === s.gmail_user.toLowerCase()) continue;
        out.push({
          messageId: e.id,
          from,
          subject: p.subject || "(no subject)",
          text: p.text || "",
          inReplyTo: typeof p.inReplyTo === "string" ? p.inReplyTo : undefined,
          date: p.date || new Date(),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

const domain = (e: string) => e.split("@")[1] ?? "";
const FREE = /^(gmail|yahoo|hotmail|outlook|icloud|live|aol|proton(mail)?)\./i;

async function matchLead(m: Raw) {
  if (m.inReplyTo) {
    const parent = (await db.select().from(messages).where(eq(messages.messageId, m.inReplyTo)))[0];
    if (parent) return (await db.select().from(leads).where(eq(leads.id, parent.leadId)))[0];
  }
  const byEmail = (await db.select().from(leads).where(eq(leads.email, m.from)))[0];
  if (byEmail) return byEmail;
  const d = domain(m.from);
  if (d && !FREE.test(d)) {
    const all = await db.select().from(leads).where(or(...[eq(leads.email, `info@${d}`)]));
    if (all[0]) return all[0];
  }
  return undefined;
}

type Cls = { classification: string; summary: string; reply: string };

async function processReply(m: Raw) {
  const lead = await matchLead(m);
  if (!lead) return; // unrelated mail
  const body = cleanReply(m.text);
  const [inbound] = await db
    .insert(messages)
    .values({ leadId: lead.id, direction: "in", kind: "inbound", fromEmail: m.from, toEmail: null, subject: m.subject, body, status: "received", messageId: m.messageId })
    .returning();
  await log("info", "inbox", `Reply from ${lead.name} <${m.from}>`);

  if (/mailer-daemon|postmaster/.test(m.from) || /undeliverable|delivery status|address not found/i.test(m.subject)) {
    await db.update(messages).set({ classification: "other", summary: "Bounce notice" }).where(eq(messages.id, inbound.id));
    if (lead.email) await block(lead.email, "bounce");
    return;
  }

  if (looksLikeStop(body)) {
    await db.update(messages).set({ classification: "STOP", summary: "Opt-out request" }).where(eq(messages.id, inbound.id));
    await block(m.from, "STOP reply");
    if (lead.email) await block(lead.email, "STOP reply");
    await log("info", "inbox", `STOP from ${m.from}: permanently blocklisted`);
    return;
  }

  const owner = await getSettings(["owner_name", "owner_phone", "tone", "manual_approve", "price", "deposit_percent"]);
  const thread = await db.select().from(messages).where(eq(messages.leadId, lead.id)).orderBy(desc(messages.id)).limit(6);
  const ctx = thread
    .reverse()
    .filter((t) => t.status === "sent" || t.status === "received")
    .map((t) => `${t.direction === "out" ? "WE SAID" : "THEY SAID"}: ${t.body.slice(0, 500)}`)
    .join("\n---\n");
  const prompt = `You handle email replies for ${owner.owner_name}, who sells professionally designed websites to local businesses in Nigeria.
We already sent ${lead.name} a free sample website: ${lead.previewUrl ?? "(link pending)"}.
Full price: NGN ${Number(owner.price).toLocaleString("en-NG")}; deposit ${owner.deposit_percent}% to start the final build.

Conversation:
${ctx}

Classify the LATEST reply as exactly one of: "interested", "question", "not interested", "STOP", "other".
Then write a reply email body from ${owner.owner_name} (${owner.tone}; plain, specific, under 110 words, no hype, no emojis, no signature, no opt-out line).
- interested: thank them, say what happens next, then on its own line write {{PAYMENT_INFO}} exactly.
- question: answer honestly and briefly; never invent facts; offer a call.
- not interested: a short, gracious close with no pressure.
- STOP: reply must be an empty string.
- other: a brief helpful reply.
Return JSON: {"classification":"...","summary":"one short sentence","reply":"..."}`;
  let c: Cls;
  try {
    c = await geminiJson<Cls>(prompt, { temperature: 0.5, maxTokens: 1500, timeoutMs: 90000 });
  } catch (e) {
    await log("error", "inbox", `Could not classify reply from ${lead.name}: ${errMsg(e)}`);
    await db.update(leads).set({ status: "replied" }).where(eq(leads.id, lead.id));
    await notify("New reply", `${lead.name} replied (not classified)`, "/inbox");
    return;
  }
  const cls = (["interested", "question", "not interested", "STOP", "other"].includes(c.classification) ? c.classification : "other") as string;
  await db.update(messages).set({ classification: cls, summary: (c.summary || "").slice(0, 300) }).where(eq(messages.id, inbound.id));

  if (cls === "STOP") {
    await block(m.from, "STOP (classified)");
    if (lead.email) await block(lead.email, "STOP (classified)");
    return;
  }
  const paidAlready = lead.status === "paid";
  await db.update(leads).set({ status: cls === "interested" ? "interested" : cls === "not interested" ? "dead" : paidAlready ? "paid" : "replied" }).where(eq(leads.id, lead.id));

  let reply = (c.reply || "").trim();
  if (cls === "interested") {
    let info: string;
    try {
      info = await paymentInfoText(lead.id, m.from);
    } catch (e) {
      info = "I will send the payment details in my next message.";
      await log("error", "payments", `Could not prepare payment info for ${lead.name}: ${errMsg(e)}`);
    }
    reply = reply.includes("{{PAYMENT_INFO}}") ? reply.replace("{{PAYMENT_INFO}}", info) : `${reply}\n\n${info}`;
  }
  reply = reply.replace("{{PAYMENT_INFO}}", "");
  if (reply) {
    const subj = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
    await db.insert(messages).values({
      leadId: lead.id,
      direction: "out",
      kind: "reply",
      toEmail: m.from,
      subject: subj,
      body: `${reply}\n\n${signature(owner)}`,
      status: owner.manual_approve === "1" ? "pending" : "approved",
      replyToId: inbound.id,
    });
    if (owner.manual_approve !== "1") kick("send");
  }
  if (cls === "interested") await notify("Interested lead", `${lead.name} wants to go ahead`, "/inbox");
  else await notify("New reply", `${lead.name}: ${(c.summary || "replied").slice(0, 100)}`, "/inbox");
}

export async function checkInbox(): Promise<number> {
  let mails: Raw[] = [];
  try {
    mails = await fetchNew();
  } catch (e) {
    await log("error", "inbox", `IMAP check failed: ${errMsg(e)}`);
    return 0;
  }
  let n = 0;
  for (const m of mails) {
    try {
      await processReply(m);
      n++;
    } catch (e) {
      await log("error", "inbox", `Processing reply from ${m.from}: ${errMsg(e)}`);
    }
  }
  if (n) await log("info", "inbox", `Processed ${n} new email(s)`);
  return n;
}
