import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, leads, messages, payments } from "@/db/schema";
import { getSettings, hasSetting } from "@/lib/settings";
import { HARD_CAP, sentToday } from "@/lib/mailer";
import { naira } from "@/lib/closing";
import { fmtDate } from "@/lib/ui";
import ActionButton from "@/components/ActionButton";
import { SettingToggle } from "@/components/Toggles";
import { getSubaccount } from "@/lib/closing";

export default async function Dashboard() {
  const s = await getSettings(["manual_approve", "daily_limit", "owner_phone", "payment_mode", "paystack_mode", "gmail_user"]);
  const count = async (q: Promise<{ c: number }[]>) => (await q)[0].c;
  const [leadCount, replies, interested, deposits, earned, today, recent] = await Promise.all([
    count(db.select({ c: sql<number>`count(*)::int` }).from(leads)),
    count(db.select({ c: sql<number>`count(*)::int` }).from(messages).where(eq(messages.direction, "in"))),
    count(db.select({ c: sql<number>`count(*)::int` }).from(leads).where(eq(leads.status, "interested"))),
    count(db.select({ c: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.kind, "deposit"), eq(payments.status, "paid")))),
    count(db.select({ c: sql<number>`coalesce(sum(amount),0)::int` }).from(payments).where(eq(payments.status, "paid"))),
    sentToday(),
    db.select().from(activity).orderBy(desc(activity.id)).limit(6),
  ]);
  const cap = Math.min(HARD_CAP, parseInt(s.daily_limit) || HARD_CAP);
  const sub = s.payment_mode === "paystack" ? await getSubaccount(s.paystack_mode === "live" ? "live" : "test") : null;

  const checks = [
    { ok: !/\[MY PHONE\]/i.test(s.owner_phone), t: "Set your phone number", href: "/settings" },
    { ok: await hasSetting("gemini_key"), t: "Add Gemini API key", href: "/settings" },
    { ok: await hasSetting("netlify_token"), t: "Add Netlify token", href: "/settings" },
    { ok: !!s.gmail_user && (await hasSetting("gmail_app_password")), t: "Add Gmail address + app password", href: "/settings" },
    s.payment_mode === "paystack"
      ? { ok: !!sub, t: "Confirm payout bank (Paystack)", href: "/settings" }
      : { ok: await hasSetting("manual_account_number"), t: "Add manual bank details", href: "/settings" },
  ];
  const todo = checks.filter((c) => !c.ok);

  const stats = [
    ["Leads found", leadCount],
    ["Sent today", `${today}/${cap}`],
    ["Replies", replies],
    ["Interested", interested],
    ["Deposits paid", deposits],
    ["Money earned", naira(earned)],
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold">Dashboard</h1>
      {todo.length > 0 && (
        <div className="card mt-3 border-amber-400 bg-amber-50">
          <div className="text-sm font-bold">Finish setup</div>
          <ul className="mt-1 list-inside list-disc text-sm">
            {todo.map((c) => (
              <li key={c.t}>
                <Link className="underline" href={c.href}>
                  {c.t}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {stats.map(([k, v]) => (
          <div key={String(k)} className="card">
            <div className="text-xs font-semibold text-slate-600">{k}</div>
            <div className="mt-1 font-serif text-2xl font-bold">{v}</div>
          </div>
        ))}
      </div>

      <div className="card mt-3">
        <SettingToggle k="manual_approve" label="Manual approve" hint={s.manual_approve === "1" ? "Pitches and replies wait for your approval" : "Fully automatic: emails send without approval"} on={s.manual_approve === "1"} />
      </div>

      <h2 className="mt-5 text-xl font-bold">Run now</h2>
      <p className="text-xs text-slate-600">Everything also runs on a schedule. These start a job in the background.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(
          [
            ["leads", "Find leads"],
            ["sites", "Make sample sites"],
            ["pitch", "Write pitches"],
            ["send", "Send approved"],
            ["inbox", "Check inbox"],
          ] as const
        ).map(([job, label]) => (
          <ActionButton key={job} label={label} path="run" body={{ job }} variant="ghost" refresh={false} className="[&>button]:w-full" />
        ))}
      </div>

      <h2 className="mt-5 text-xl font-bold">Recent activity</h2>
      <div className="mt-2 space-y-1.5">
        {recent.map((a) => (
          <div key={a.id} className={`rounded border-l-4 bg-white px-3 py-2 text-xs ${a.level === "error" ? "border-red-600" : a.level === "warn" ? "border-amber-500" : "border-line"}`}>
            <span className="text-slate-500">{fmtDate(a.createdAt)} · {a.type}</span>
            <div className="break-words">{a.message}</div>
          </div>
        ))}
        {!recent.length && <p className="text-sm text-slate-600">Nothing yet.</p>}
      </div>
    </div>
  );
}
