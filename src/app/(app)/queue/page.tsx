import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leads, messages } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { HARD_CAP, sentToday } from "@/lib/mailer";
import { fmtDate } from "@/lib/ui";
import MessageCard from "@/components/MessageCard";
import { SettingToggle } from "@/components/Toggles";
import ActionButton from "@/components/ActionButton";

export default async function Queue() {
  const manual = (await getSetting("manual_approve")) === "1";
  const limit = Math.min(HARD_CAP, parseInt(await getSetting("daily_limit")) || HARD_CAP);
  const [pending, approved, recent, names, today] = await Promise.all([
    db.select().from(messages).where(and(eq(messages.direction, "out"), inArray(messages.status, ["pending", "failed"]))).orderBy(desc(messages.id)).limit(60),
    db.select().from(messages).where(and(eq(messages.direction, "out"), eq(messages.status, "approved"))).orderBy(messages.id),
    db.select().from(messages).where(and(eq(messages.direction, "out"), eq(messages.status, "sent"))).orderBy(desc(messages.sentAt)).limit(8),
    db.select({ id: leads.id, name: leads.name }).from(leads),
    sentToday(),
  ]);
  const nm = new Map(names.map((n) => [n.id, n.name]));
  return (
    <div>
      <h1 className="text-3xl font-bold">Approval Queue</h1>
      <div className="card mt-3">
        <SettingToggle k="manual_approve" label="Manual approve" hint={manual ? "ON: you approve every email" : "OFF: fully automatic sending"} on={manual} />
        <div className="mt-1 text-xs text-slate-600">Sent today: {today}/{limit} (hard cap {HARD_CAP}/day)</div>
      </div>

      {approved.length > 0 && (
        <div className="card mt-3 text-sm">
          <b>{approved.length} approved, waiting to send</b>
          <p className="text-xs text-slate-600">Sent one at a time with random delays.</p>
          <div className="mt-2">
            <ActionButton label="Send now" path="run" body={{ job: "send" }} variant="ghost" small />
          </div>
        </div>
      )}

      <h2 className="mt-5 text-xl font-bold">Waiting for you ({pending.length})</h2>
      {pending.map((m) => (
        <MessageCard key={m.id} m={m} leadName={nm.get(m.leadId)} />
      ))}
      {!pending.length && <p className="mt-2 text-sm text-slate-600">Nothing to approve. New pitches and replies appear here.</p>}

      <h2 className="mt-5 text-xl font-bold">Recently sent</h2>
      <div className="mt-2 space-y-1.5 pb-4">
        {recent.map((m) => (
          <div key={m.id} className="rounded bg-white px-3 py-2 text-xs">
            <span className="text-slate-500">{fmtDate(m.sentAt)} · {m.kind}</span>
            <div className="truncate">{m.toEmail}: {m.subject}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
