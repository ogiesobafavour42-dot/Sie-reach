import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { blocklist, leads, messages, payments, pushSubs, sites } from "@/db/schema";
import { COOKIE, isAuthed } from "@/lib/auth";
import { checkPassword, hashPassword, signSession } from "@/lib/crypto";
import { DEFAULTS, deleteSetting, getSetting, getSettings, hasSetting, lastFour, setSetting } from "@/lib/settings";
import { errMsg, log } from "@/lib/log";
import { ensureVapid, notify } from "@/lib/push";
import { JOBS, kick, runJob, type JobName } from "@/lib/jobs";
import { tick } from "@/lib/scheduler";
import { generateSite } from "@/lib/sitegen";
import { writePitch } from "@/lib/pitch";
import { createHandoverDraft, getSubaccount, markLeadPaidManually, markPaid, paymentInfoText, verifyAndMark } from "@/lib/closing";
import { createSubaccount, listBanks, psContext, resolveAccount } from "@/lib/paystack";

export type Ctx = { params: Promise<{ slug: string[] }> };
type Body = Record<string, unknown>;
const json = (d: unknown, status = 200) => Response.json(d, { status });
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" ? v : parseInt(String(v)) || 0);

const attempts = new Map<string, { n: number; at: number }>();
function limited(ip: string) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.at > 15 * 60e3) return false;
  return a.n >= 6;
}
function fail(ip: string) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.at > 15 * 60e3) attempts.set(ip, { n: 1, at: Date.now() });
  else a.n++;
}

const API_SECRETS = ["gemini_key", "gmail_app_password", "netlify_token", "paystack_secret", "manual_account_number"];
const LEAD_STATUSES = ["new", "pitched", "replied", "interested", "paid", "dead"];

async function setSession(req: Request) {
  const secure = req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
  (await cookies()).set(COOKIE, await signSession(30), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 30 * 86400 });
}

export async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const path = (await ctx.params).slug.join("/");
  const isPost = req.method === "POST";
  try {
    if (isPost && !(req.headers.get("content-type") || "").includes("application/json")) return json({ error: "Unsupported content type" }, 415);
    const body: Body = isPost ? ((await req.json().catch(() => ({}))) as Body) : {};
    const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();

    // ---------- public ----------
    if (path === "session") {
      return json({ authed: await isAuthed(), configured: await hasSetting("owner_password_hash") });
    }
    if (path === "setup" && isPost) {
      if (await hasSetting("owner_password_hash")) return json({ error: "Owner account already exists" }, 403);
      const pw = str(body.password);
      if (pw.length < 8) return json({ error: "Use at least 8 characters" }, 400);
      await setSetting("owner_password_hash", hashPassword(pw));
      await setSession(req);
      await log("info", "auth", "Owner account created");
      return json({ ok: true });
    }
    if (path === "login" && isPost) {
      if (limited(ip)) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
      const stored = await getSetting("owner_password_hash");
      if (!stored || !checkPassword(str(body.password), stored)) {
        fail(ip);
        return json({ error: "Wrong password" }, 401);
      }
      attempts.delete(ip);
      await setSession(req);
      return json({ ok: true });
    }
    if (path === "logout" && isPost) {
      (await cookies()).delete(COOKIE);
      return json({ ok: true });
    }
    if (path === "cron") {
      const secret = process.env.CRON_SECRET;
      const given = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret");
      if (!secret || given !== secret) return json({ error: "Forbidden" }, 403);
      await tick();
      return json({ ok: true });
    }

    // ---------- authenticated ----------
    if (!(await isAuthed())) return json({ error: "Not signed in" }, 401);

    switch (path) {
      case "settings": {
        if (!isPost) {
          const vals = await getSettings(Object.keys(DEFAULTS));
          const secrets: Record<string, boolean> = {};
          for (const k of API_SECRETS) secrets[k] = await hasSetting(k);
          const key = await getSetting("paystack_secret");
          const pendingRaw = await getSetting("paystack_pending_account");
          let pending: { account_name: string; bank_name: string; account_number: string } | null = null;
          try {
            pending = pendingRaw ? JSON.parse(pendingRaw) : null;
          } catch {}
          const origin = `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("x-forwarded-host") || req.headers.get("host")}`;
          return json({
            values: vals,
            secrets,
            keyMode: key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : key ? "invalid" : "",
            manualLast4: lastFour(await getSetting("manual_account_number")),
            sub: { test: await getSubaccount("test"), live: await getSubaccount("live") },
            pending: pending ? { account_name: pending.account_name, bank_name: pending.bank_name, last4: lastFour(pending.account_number) } : null,
            webhookUrl: `${origin}/api/paystack/webhook`,
          });
        }
        const values = (body.values ?? {}) as Body;
        for (const [k, raw] of Object.entries(values)) {
          let v = str(raw);
          if (k in DEFAULTS) {
            if (k === "daily_limit") v = String(Math.min(20, Math.max(1, num(v) || 20)));
            if (k === "price" && !(parseFloat(v) > 0)) return json({ error: "Price must be a positive number" }, 400);
            if (k === "deposit_percent") v = String(Math.min(100, Math.max(1, num(v) || 50)));
            if (k === "payment_mode" && !["paystack", "manual"].includes(v)) continue;
            if (k === "paystack_mode" && !["test", "live"].includes(v)) continue;
            await setSetting(k, v, false);
          } else if (API_SECRETS.includes(k)) {
            if (!v) continue; // empty = keep existing
            if (k === "paystack_secret" && !/^sk_(test|live)_/.test(v)) return json({ error: "That is not a Paystack SECRET key (it must start with sk_test_ or sk_live_)." }, 400);
            if (k === "gmail_app_password") v = v.replace(/\s+/g, "");
            await setSetting(k, v);
          }
        }
        for (const k of (Array.isArray(body.clear) ? body.clear : []) as string[]) if (API_SECRETS.includes(k)) await deleteSetting(k);
        await log("info", "settings", "Settings updated");
        return json({ ok: true });
      }
      case "password": {
        const stored = await getSetting("owner_password_hash");
        if (!checkPassword(str(body.current), stored)) return json({ error: "Current password is wrong" }, 400);
        if (str(body.next).length < 8) return json({ error: "Use at least 8 characters" }, 400);
        await setSetting("owner_password_hash", hashPassword(str(body.next)));
        return json({ ok: true });
      }
      case "killswitch": {
        const on = body.on === true;
        await setSetting("kill_switch", on ? "1" : "0", false);
        await log(on ? "warn" : "info", "system", on ? "KILL SWITCH ON: all sending stopped" : "Kill switch released");
        return json({ ok: true });
      }
      case "toggle": {
        const k = str(body.key);
        if (!["manual_approve", "auto_leads", "auto_sites", "auto_pitch", "auto_send", "auto_inbox", "notify_push"].includes(k)) return json({ error: "Bad key" }, 400);
        await setSetting(k, body.on ? "1" : "0", false);
        await log("info", "settings", `${k} → ${body.on ? "on" : "off"}`);
        return json({ ok: true });
      }
      case "run": {
        const job = str(body.job) as JobName;
        if (!(job in JOBS)) return json({ error: "Unknown job" }, 400);
        kick(job);
        return json({ ok: true, message: `${job} started in the background. Watch the Activity log.` });
      }

      // ----- paystack payout bank -----
      case "paystack/banks":
        return json({ banks: await listBanks() });
      case "paystack/resolve": {
        const acct = str(body.account_number);
        const code = str(body.bank_code);
        if (!/^\d{10}$/.test(acct)) return json({ error: "Account number must be 10 digits" }, 400);
        const r = await resolveAccount(acct, code);
        const bank = (await listBanks()).find((b) => b.code === code);
        await setSetting("paystack_pending_account", JSON.stringify({ bank_code: code, bank_name: bank?.name ?? code, account_number: acct, account_name: r.account_name }));
        return json({ account_name: r.account_name, bank_name: bank?.name ?? code, last4: lastFour(acct) });
      }
      case "paystack/confirm": {
        const raw = await getSetting("paystack_pending_account");
        if (!raw) return json({ error: "Nothing to confirm. Look up the account first." }, 400);
        const p = JSON.parse(raw) as { bank_code: string; bank_name: string; account_number: string; account_name: string };
        const { mode } = await psContext();
        const sub = await createSubaccount({ business_name: p.account_name, bank_code: p.bank_code, account_number: p.account_number });
        await setSetting(`paystack_sub_${mode}`, JSON.stringify({ code: sub.subaccount_code, bank_name: p.bank_name, last4: lastFour(p.account_number), account_name: p.account_name }), false);
        await deleteSetting("paystack_pending_account");
        await log("info", "payments", `Paystack ${mode} subaccount created for ${p.bank_name} ••••${lastFour(p.account_number)}`);
        return json({ ok: true, mode });
      }
      case "paystack/reject":
        await deleteSetting("paystack_pending_account");
        return json({ ok: true });

      // ----- leads -----
      case "lead": {
        const id = num(body.id);
        switch (str(body.action)) {
          case "add": {
            const name = str(body.name);
            if (!name) return json({ error: "Name required" }, 400);
            const city = (await getSetting("city")) || null;
            await db.insert(leads).values({ name, email: str(body.email).toLowerCase() || null, website: str(body.website) || null, phone: str(body.phone) || null, city, niche: await getSetting("niche") });
            return json({ ok: true });
          }
          case "status": {
            const st = str(body.status);
            if (!LEAD_STATUSES.includes(st)) return json({ error: "Bad status" }, 400);
            await db.update(leads).set({ status: st }).where(eq(leads.id, id));
            return json({ ok: true });
          }
          case "sample":
            void runJob(`sample-${id}`, async () => {
              await generateSite(id, "sample").catch(() => {});
            });
            return json({ ok: true, message: "Generating sample site… this takes a minute. Watch Activity." });
          case "pitch":
            void runJob(`pitch-${id}`, async () => {
              await writePitch(id).catch((e) => log("error", "pitch", errMsg(e)));
            });
            return json({ ok: true, message: "Writing pitch… check the Approval Queue shortly." });
          case "deposit": {
            const text = await paymentInfoText(id);
            return json({ ok: true, text });
          }
          case "markpaid": {
            const k = str(body.kind) === "final" ? "final" : "deposit";
            const done = await markLeadPaidManually(id, k);
            return json({ ok: true, message: done ? (k === "deposit" ? "Marked as paid. Building the final site…" : "Final payment recorded.") : "Already paid" });
          }
          case "handover":
            await createHandoverDraft(id);
            return json({ ok: true, message: "Handover email added to the Approval Queue." });
          case "final":
            void runJob(`final-${id}`, async () => {
              await generateSite(id, "final").catch(() => {});
            });
            return json({ ok: true, message: "Building final site… watch Activity." });
          case "delete": {
            await db.delete(messages).where(eq(messages.leadId, id));
            await db.delete(sites).where(eq(sites.leadId, id));
            await db.delete(payments).where(eq(payments.leadId, id));
            await db.delete(leads).where(eq(leads.id, id));
            return json({ ok: true });
          }
        }
        return json({ error: "Unknown action" }, 400);
      }

      // ----- messages -----
      case "message": {
        const id = num(body.id);
        const m = (await db.select().from(messages).where(eq(messages.id, id)))[0];
        if (!m) return json({ error: "Message not found" }, 404);
        const action = str(body.action);
        const edits = {
          ...(typeof body.subject === "string" && body.subject.trim() ? { subject: body.subject.trim().slice(0, 200) } : {}),
          ...(typeof body.body === "string" && body.body.trim() ? { body: body.body.trim().slice(0, 6000) } : {}),
        };
        if (action === "edit") {
          await db.update(messages).set(edits).where(eq(messages.id, id));
          return json({ ok: true });
        }
        if (action === "reject") {
          await db.update(messages).set({ status: "rejected" }).where(and(eq(messages.id, id), inArray(messages.status, ["pending", "approved", "failed"])));
          return json({ ok: true });
        }
        if (action === "approve" || action === "retry") {
          if (m.direction !== "out" || !["pending", "failed", "rejected"].includes(m.status)) return json({ error: "Nothing to approve" }, 400);
          if (m.toEmail && (await db.select().from(blocklist).where(eq(blocklist.email, m.toEmail.toLowerCase()))).length) return json({ error: "This address is on the STOP blocklist" }, 400);
          await db.update(messages).set({ ...edits, status: "approved", error: null }).where(eq(messages.id, id));
          const killed = (await getSetting("kill_switch")) === "1";
          if (!killed) kick("send");
          return json({ ok: true, message: killed ? "Approved, but the kill switch is ON so nothing will send." : "Approved. Sending shortly (with a short random delay)." });
        }
        return json({ error: "Unknown action" }, 400);
      }

      // ----- sites -----
      case "site": {
        const s = (await db.select().from(sites).where(eq(sites.id, num(body.id))))[0];
        if (!s) return json({ error: "Site not found" }, 404);
        await db.update(sites).set({ attempts: 0 }).where(eq(sites.id, s.id));
        const kind = s.kind as "sample" | "final";
        void runJob(`${kind === "final" ? "final" : "sample"}-${s.leadId}`, async () => {
          await generateSite(s.leadId, kind).catch(() => {});
        });
        return json({ ok: true, message: "Regenerating… this takes a minute or two." });
      }
      case "sitehtml": {
        const u = new URL(req.url);
        const s = (await db.select().from(sites).where(eq(sites.id, num(u.searchParams.get("id")))))[0];
        if (!s) return new Response("Not found", { status: 404 });
        const files = JSON.parse(s.files || "{}") as Record<string, string>;
        const html = files[u.searchParams.get("file") || "index.html"] ?? files["index.html"] ?? "<p>No HTML stored</p>";
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox allow-scripts" } });
      }

      // ----- payments -----
      case "payment": {
        const id = num(body.id);
        const p = (await db.select().from(payments).where(eq(payments.id, id)))[0];
        if (!p) return json({ error: "Payment not found" }, 404);
        if (str(body.action) === "verify") {
          const r = await verifyAndMark(id);
          return json({ ok: r.ok, message: r.message });
        }
        if (str(body.action) === "markpaid") {
          if (p.mode !== "manual") await db.update(payments).set({ mode: "manual" }).where(eq(payments.id, id));
          const ok = await markPaid(id, false);
          return json({ ok: true, message: ok ? "Marked as paid" : "Already paid" });
        }
        return json({ error: "Unknown action" }, 400);
      }

      // ----- push -----
      case "push/key":
        return json({ key: await ensureVapid() });
      case "push/subscribe": {
        const sub = body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: "Bad subscription" }, 400);
        await db.insert(pushSubs).values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }).onConflictDoUpdate({ target: pushSubs.endpoint, set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
        return json({ ok: true });
      }
      case "push/test":
        await notify("SiteReach", "Push notifications are working.", "/");
        return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: errMsg(e) }, 500);
  }
}
