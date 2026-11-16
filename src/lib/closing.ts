import crypto from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { leads, messages, payments } from "@/db/schema";
import { getSetting, getSettings } from "./settings";
import { initTransaction, psContext, verifySignature, verifyTransaction, type PsMode } from "./paystack";
import { errMsg, log } from "./log";
import { notify } from "./push";
import { generateSite } from "./sitegen";
import { runJob } from "./jobs";
import { signature } from "./pitch";

export const naira = (kobo: number) => "₦" + (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });

export type SubInfo = { code: string; bank_name: string; last4: string; account_name: string };

export async function getSubaccount(mode: PsMode): Promise<SubInfo | null> {
  const v = await getSetting(`paystack_sub_${mode}`);
  if (!v) return null;
  try {
    return JSON.parse(v) as SubInfo;
  } catch {
    return null;
  }
}

async function amountFor(kind: "deposit" | "final") {
  const s = await getSettings(["price", "deposit_percent"]);
  const total = Math.round((parseFloat(s.price) || 0) * 100);
  const pct = Math.min(100, Math.max(1, parseFloat(s.deposit_percent) || 50));
  const dep = Math.round((total * pct) / 100);
  if (total <= 0) throw new Error("Set your website price in Settings first.");
  return kind === "deposit" ? dep : Math.max(total - dep, 100);
}

export async function getOrCreatePayment(leadId: number, kind: "deposit" | "final", clientEmail?: string) {
  const lead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
  if (!lead) throw new Error("Lead not found");
  const mode = await getSetting("payment_mode");
  const amount = await amountFor(kind);
  const psMode = mode === "paystack" ? (await psContext()).mode : null;

  const existing = (
    await db.select().from(payments).where(and(eq(payments.leadId, leadId), eq(payments.kind, kind), eq(payments.status, "pending"), eq(payments.mode, mode))).orderBy(desc(payments.id))
  )[0];
  if (existing && existing.amount === amount && (mode === "manual" || (existing.paystackMode === psMode && existing.paymentUrl))) return existing;

  if (mode === "paystack") {
    const sub = await getSubaccount(psMode!);
    if (!sub) throw new Error(`No confirmed payout account for ${psMode} mode. Add and confirm it in Settings → Payout bank.`);
    const email = clientEmail || lead.email;
    if (!email) throw new Error("No client email for this lead: Paystack needs one.");
    const reference = `sr_${leadId}_${kind[0]}_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
    const tx = await initTransaction({ email, amountKobo: amount, reference, subaccount: sub.code, metadata: { lead_id: leadId, kind, app: "sitereach" } });
    const [p] = await db.insert(payments).values({ leadId, kind, amount, mode, paystackMode: psMode, reference, paymentUrl: tx.authorization_url }).returning();
    await log("info", "payments", `Created ${psMode} ${kind} payment link (${naira(amount)}) for ${lead.name}`);
    return p;
  }
  const reference = `man_${leadId}_${kind[0]}_${Date.now().toString(36)}`;
  const [p] = await db.insert(payments).values({ leadId, kind, amount, mode: "manual", reference }).returning();
  await log("info", "payments", `Created manual ${kind} request (${naira(amount)}) for ${lead.name}`);
  return p;
}

export async function bankDetailsText() {
  const s = await getSettings(["manual_bank_name", "manual_account_name", "manual_account_number"]);
  if (!s.manual_bank_name || !s.manual_account_name || !s.manual_account_number) {
    throw new Error("Manual bank details are incomplete (Settings → Manual bank transfer).");
  }
  return `Bank: ${s.manual_bank_name}\nAccount name: ${s.manual_account_name}\nAccount number: ${s.manual_account_number}`;
}

export async function paymentInfoText(leadId: number, clientEmail?: string, kind: "deposit" | "final" = "deposit") {
  const p = await getOrCreatePayment(leadId, kind, clientEmail);
  const label = kind === "deposit" ? "deposit" : "final balance";
  if (p.mode === "paystack") return `The ${label} is ${naira(p.amount)}. You can pay securely by card or transfer here:\n${p.paymentUrl}`;
  return `The ${label} is ${naira(p.amount)}. You can pay by bank transfer to:\n${await bankDetailsText()}\nPlease reply with the transfer receipt once done.`;
}

export async function markPaid(paymentId: number, verified: boolean): Promise<boolean> {
  const [p] = await db.update(payments).set({ status: "paid", paidAt: new Date(), verified }).where(and(eq(payments.id, paymentId), ne(payments.status, "paid"))).returning();
  if (!p) return false;
  const lead = (await db.select().from(leads).where(eq(leads.id, p.leadId)))[0];
  if (lead && p.kind === "deposit") await db.update(leads).set({ status: "paid" }).where(eq(leads.id, lead.id));
  await log("info", "payments", `${p.kind} of ${naira(p.amount)} paid by ${lead?.name ?? p.leadId} (${p.mode}${verified ? ", verified" : ""})`);
  await notify("Payment received", `${naira(p.amount)} ${p.kind} from ${lead?.name ?? "a client"}`, `/leads/${p.leadId}`);
  if (p.kind === "deposit") {
    void runJob(`final-${p.leadId}`, async () => {
      try {
        await generateSite(p.leadId, "final");
      } catch {
        /* logged inside */
      }
    });
  }
  return true;
}

/** Confirms with Paystack's Verify API before marking paid. */
export async function verifyAndMark(paymentId: number): Promise<{ ok: boolean; message: string }> {
  const p = (await db.select().from(payments).where(eq(payments.id, paymentId)))[0];
  if (!p) return { ok: false, message: "Payment not found" };
  if (p.status === "paid") return { ok: true, message: "Already paid" };
  if (p.mode !== "paystack") return { ok: false, message: "Manual payments are confirmed with “Mark as paid”." };
  const tx = await verifyTransaction(p.reference);
  if (tx.status !== "success") return { ok: false, message: `Paystack says: ${tx.status}` };
  if (tx.amount < p.amount || tx.currency !== p.currency) {
    await log("error", "payments", `Amount mismatch for ${p.reference}: paid ${tx.amount}, expected ${p.amount}`);
    return { ok: false, message: "Amount mismatch" };
  }
  await markPaid(p.id, true);
  return { ok: true, message: "Payment verified" };
}

export async function handleWebhook(raw: string, sig: string | null): Promise<{ status: number; body: string }> {
  const secret = await getSetting("paystack_secret");
  if (!verifySignature(raw, sig, secret)) {
    await log("warn", "webhook", "Rejected webhook with invalid signature");
    return { status: 401, body: "invalid signature" };
  }
  let ev: { event?: string; data?: { reference?: string } };
  try {
    ev = JSON.parse(raw);
  } catch {
    return { status: 400, body: "bad json" };
  }
  await log("info", "webhook", `Paystack event ${ev.event} ${ev.data?.reference ?? ""}`);
  if (ev.event !== "charge.success" || !ev.data?.reference) return { status: 200, body: "ignored" };
  const p = (await db.select().from(payments).where(eq(payments.reference, ev.data.reference)))[0];
  if (!p) return { status: 200, body: "unknown reference" };
  try {
    const r = await verifyAndMark(p.id);
    if (!r.ok) await log("error", "webhook", `Verification failed for ${p.reference}: ${r.message}`);
  } catch (e) {
    await log("error", "webhook", `Verification error for ${p.reference}: ${errMsg(e)}`);
    return { status: 500, body: "verify failed, retry" }; // Paystack retries
  }
  return { status: 200, body: "ok" };
}

/** Draft handover email (with the balance payment info) to the approval queue. */
export async function createHandoverDraft(leadId: number) {
  const lead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
  if (!lead?.email) throw new Error("Lead has no email");
  if (!lead.finalUrl) throw new Error("Final site is not ready yet");
  const owner = await getSettings(["owner_name", "owner_phone"]);
  const info = await paymentInfoText(leadId, lead.email, "final");
  const body = `Hello,\n\nThank you for the deposit. Your website is ready for review:\n${lead.finalUrl}\n\nPlease check every page and send me any changes. Once you are happy, ${info.charAt(0).toLowerCase()}${info.slice(1)}\n\nAfter the balance is received I will connect your own domain name and hand everything over.\n\n${signature(owner)}`;
  await db.insert(messages).values({ leadId, direction: "out", kind: "reply", toEmail: lead.email.toLowerCase(), subject: `Your website is ready: ${lead.name}`, body, status: "pending" });
}

/** Owner taps "Mark as paid": works for manual transfers (and overrides a Paystack link if needed). */
export async function markLeadPaidManually(leadId: number, kind: "deposit" | "final") {
  let p = (await db.select().from(payments).where(and(eq(payments.leadId, leadId), eq(payments.kind, kind), eq(payments.status, "pending"))).orderBy(desc(payments.id)))[0];
  if (!p) {
    const amount = await amountFor(kind);
    [p] = await db.insert(payments).values({ leadId, kind, amount, mode: "manual", reference: `man_${leadId}_${kind[0]}_${Date.now().toString(36)}` }).returning();
  } else if (p.mode !== "manual") {
    await db.update(payments).set({ mode: "manual" }).where(eq(payments.id, p.id));
    await log("warn", "payments", `Payment ${p.reference} was marked as paid manually by the owner`);
  }
  return markPaid(p.id, false);
}
