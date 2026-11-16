import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leads, messages } from "@/db/schema";
import { fmtDate } from "@/lib/ui";
import MessageCard from "@/components/MessageCard";
import ActionButton from "@/components/ActionButton";

const CLS: Record<string, string> = {
  interested: "bg-emerald-100 text-emerald-900",
  question: "bg-sky-100 text-sky-900",
  "not interested": "bg-red-100 text-red-900",
  STOP: "bg-red-700 text-white",
  other: "bg-slate-200",
};

export default async function Inbox() {
  const inbound = await db.select().from(messages).where(eq(messages.direction, "in")).orderBy(desc(messages.id)).limit(200);
  const leadIds = [...new Set(inbound.map((m) => m.leadId))].slice(0, 25);
  const rows = leadIds.length ? await db.select().from(leads).where(inArray(leads.id, leadIds)) : [];
  const all = leadIds.length ? await db.select().from(messages).where(inArray(messages.leadId, leadIds)).orderBy(asc(messages.id)) : [];
  const order = new Map(leadIds.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Inbox</h1>
        <ActionButton label="Check now" path="run" body={{ job: "inbox" }} variant="ghost" small refresh={false} />
      </div>
      <p className="mt-1 text-xs text-slate-600">Gmail is checked automatically every few minutes. Replies appear with an AI-drafted answer underneath.</p>
      <div className="mt-3 space-y-4 pb-4">
        {rows.map((l) => {
          const thread = all.filter((m) => m.leadId === l.id && ["sent", "received", "pending", "approved", "failed"].includes(m.status)).slice(-8);
          return (
            <section key={l.id} className="card">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/leads/${l.id}`} className="font-semibold underline">{l.name}</Link>
                <span className="badge">{l.status}</span>
              </div>
              <div className="mt-2 space-y-2">
                {thread.map((m) =>
                  m.status === "pending" || m.status === "failed" ? (
                    <MessageCard key={m.id} m={m} sendLabel="Send reply" />
                  ) : (
                    <div key={m.id} className={`rounded-lg p-2.5 text-sm ${m.direction === "in" ? "mr-6 bg-white ring-1 ring-gold" : "ml-6 bg-ivory ring-1 ring-line"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-600">
                        <span>
                          {m.direction === "in" ? "Them" : "You"} · {m.status === "approved" ? "sending…" : fmtDate(m.sentAt ?? m.createdAt)}
                        </span>
                        {m.classification && <span className={`badge ${CLS[m.classification] ?? ""}`}>{m.classification}</span>}
                      </div>
                      {m.summary && <div className="mt-1 text-xs italic text-slate-600">{m.summary}</div>}
                      <div className="mt-1 whitespace-pre-wrap">{m.body}</div>
                    </div>
                  ),
                )}
              </div>
            </section>
          );
        })}
        {!rows.length && <p className="text-sm text-slate-600">No replies yet.</p>}
      </div>
    </div>
  );
}
