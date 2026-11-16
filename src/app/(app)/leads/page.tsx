import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { STATUS_COLORS } from "@/lib/ui";
import { AddLead } from "@/components/LeadForms";

const FILTERS = ["all", "new", "pitched", "replied", "interested", "paid", "dead"];

export default async function Leads({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const f = FILTERS.includes(status ?? "") ? status! : "all";
  const rows = f === "all" ? await db.select().from(leads).orderBy(desc(leads.id)).limit(120) : await db.select().from(leads).where(eq(leads.status, f)).orderBy(desc(leads.id)).limit(120);
  return (
    <div>
      <h1 className="text-3xl font-bold">Leads</h1>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-2">
        {FILTERS.map((x) => (
          <Link key={x} href={x === "all" ? "/leads" : `/leads?status=${x}`} className={`badge whitespace-nowrap px-3 py-1.5 text-xs ${f === x ? "bg-navy text-ivory" : ""}`}>
            {x}
          </Link>
        ))}
      </div>
      <AddLead />
      <div className="space-y-2">
        {rows.map((l) => (
          <Link key={l.id} href={`/leads/${l.id}`} className="card block">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold">{l.name}</div>
              <span className={`badge ${STATUS_COLORS[l.status] ?? ""}`}>{l.status}</span>
            </div>
            <div className="mt-1 break-all text-xs text-slate-600">{l.email || "no email"} · {l.website || "no website"}</div>
            {l.previewUrl && <div className="mt-1 text-xs text-gold">Preview ready</div>}
          </Link>
        ))}
        {!rows.length && <p className="text-sm text-slate-600">No leads here yet. Use “Find leads” on the dashboard or add one manually.</p>}
      </div>
    </div>
  );
}
