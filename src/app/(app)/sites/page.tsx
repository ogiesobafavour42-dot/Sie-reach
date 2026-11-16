import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, sites } from "@/db/schema";
import { fmtDate, thumb } from "@/lib/ui";
import ActionButton from "@/components/ActionButton";

export default async function Sites() {
  const rows = await db
    .select({ s: sites, name: leads.name })
    .from(sites)
    .leftJoin(leads, eq(leads.id, sites.leadId))
    .orderBy(desc(sites.updatedAt))
    .limit(60);
  return (
    <div>
      <h1 className="text-3xl font-bold">Sites</h1>
      <p className="mt-1 text-xs text-slate-600">Screenshots load only when you scroll to them, to save data.</p>
      <div className="mt-3 space-y-3 pb-4">
        {rows.map(({ s, name }) => (
          <div key={s.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/leads/${s.leadId}`} className="font-semibold underline">{name}</Link>
              <div className="flex gap-1">
                <span className={`badge ${s.kind === "final" ? "bg-emerald-100 text-emerald-900" : ""}`}>{s.kind}</span>
                <span className={`badge ${s.status === "failed" ? "bg-red-100 text-red-900" : s.status === "live" ? "bg-sky-100 text-sky-900" : ""}`}>{s.status}</span>
              </div>
            </div>
            {s.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb(s.url)} alt={`Screenshot of ${name}`} loading="lazy" className="mt-2 h-44 w-full rounded border border-line bg-white object-cover object-top" />
            )}
            {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-gold underline">{s.url}</a>}
            {s.notes && <p className="mt-1 line-clamp-3 text-xs text-slate-600">{s.notes}</p>}
            <div className="mt-1 text-[11px] text-slate-500">Updated {fmtDate(s.updatedAt)} · attempts {s.attempts}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton label="Regenerate" path="site" body={{ id: s.id }} variant="ghost" small refresh={false} confirm="Regenerate this site? It takes a minute or two." />
              <a className="btn btn-ghost btn-sm" href={`/api/sitehtml?id=${s.id}`} target="_blank" rel="noreferrer">View HTML</a>
            </div>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-600">No sites yet. Sample sites are generated automatically for new leads that have an email.</p>}
      </div>
    </div>
  );
}
