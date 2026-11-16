import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, messages } from "@/db/schema";
import { geminiJson } from "./gemini";
import { getSettings } from "./settings";
import { log } from "./log";

export const OPT_OUT = "Reply STOP to opt out.";
export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function signature(owner: Record<string, string>) {
  return `${owner.owner_name}\n${owner.owner_phone}\n${OPT_OUT}`;
}

export async function writePitch(leadId: number) {
  const lead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
  if (!lead || !lead.email) throw new Error("Lead has no email");
  if (!lead.previewUrl) throw new Error("Lead has no preview link yet");
  const owner = await getSettings(["owner_name", "owner_phone", "tone", "manual_approve"]);
  if (/\[MY PHONE\]/i.test(owner.owner_phone)) throw new Error("Set your phone number in Settings before writing pitches.");
  let facts: { description?: string; title?: string } = {};
  try {
    facts = JSON.parse(lead.facts);
  } catch {}
  const sig = signature(owner);
  let subject = "";
  let body = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt = `Write a short cold email to a local business offering a free sample website that has already been designed for them.
Business: ${lead.name} (${lead.niche ?? "business"}, ${lead.city ?? ""})
What we know: ${(facts.description || facts.title || "").slice(0, 200)}
Free preview link: ${lead.previewUrl}
Tone: ${owner.tone}. Friendly, specific, no hype, no flattery, no emojis.
Rules: the body must be at most ${attempt === 0 ? 60 : 45} words (greeting included, signature NOT included). Mention one specific thing about the business. Include the preview link once. Ask if they would like to see more. Do not add a signature or opt-out line.
Return JSON: {"subject": "...", "body": "..."}`;
    const j = await geminiJson<{ subject: string; body: string }>(prompt, { temperature: 0.8, maxTokens: 1024, timeoutMs: 60000 });
    subject = (j.subject || "").replace(/\n/g, " ").trim();
    body = (j.body || "").trim();
    if (subject && body && words(`${body}\n${sig}`) <= 90) break;
    if (attempt === 2) throw new Error(`Pitch for ${lead.name} was over 90 words after 3 tries`);
  }
  const auto = owner.manual_approve !== "1";
  const full = `${body}\n\n${sig}`;
  await db.insert(messages).values({
    leadId,
    direction: "out",
    kind: "pitch",
    toEmail: lead.email.toLowerCase(),
    subject,
    body: full,
    status: auto ? "approved" : "pending",
  });
  await log("info", "pitch", `Pitch written for ${lead.name} (${words(full)} words, ${auto ? "auto-approved" : "awaiting approval"})`);
}

export async function hasPitch(leadId: number) {
  const r = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.leadId, leadId), eq(messages.kind, "pitch")));
  return r.length > 0;
}
