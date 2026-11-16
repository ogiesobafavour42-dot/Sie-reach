import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, messages, payments, sites } from "@/db/schema";
import { STATUS_COLORS, fmtDate } from "@/lib/ui";
import { naira } from "@/lib/closing";
import { getSetting } from "@/lib/settings";
import ActionButton from "@/components/ActionButton";
import { CopyBox, StatusSelect } from "@/components/LeadForms";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseInt((await params).id);
  if (!id) notFound();
  const lead = (await db.select().from(leads).where(eq(leads.id, id)))[0];
  if (!lead) notFound();
  const [msgs, pays, siteRows, ownerName, ownerPhone] = await Promise.all([
    db.select().from(messages).where(eq(messages.leadId, id)).orderBy(asc(messages.id)),
    db.select().from(payments).where(eq(payments.leadId, id)).orderBy(desc(payments.id)),
    db.select().from(sites).where(eq(sites.leadId, id)).orderBy(asc(sites.id)),
    getSetting("owner_name"),
    getSetting("owner_phone"),
  ]);
  let facts: { description?: string; title?: string; colors?: string[]; logo?: string | null; headings?: string[] } = {};
  try {
    facts = JSON.parse(lead.facts);
  } catch {}
  const depositPaid = pays.some((p) => p.kind === "deposit" && p.status === "paid");
  const finalPaid = pays.some((p) => p.kind === "final" && p.status === "paid");
  const finalSite = siteRows.find((s) => s.kind === "final");
  const netlifyName = lead.finalUrl ? lead.finalUrl.replace(/^https?:\/\//, "").replace(/\.netlify\.app.*/, "") : "";

  const handover = `Hello,

Your new website is live and ready for you:
${lead.finalUrl ?? "[final link]"}

What happens next:
1. Please check every page and send me any corrections, plus real photos, fees and testimonials to replace the placeholders marked [sample].
2. Tell me the domain name you would like to use (for example ${lead.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18)}.com or .ng). If you already own one, send the registrar name.
3. I will connect the domain and enable HTTPS, then send you the hand-over details.

Thank you for trusting us with your website.

${ownerName}
${ownerPhone}`;

  return (
    <div>
      <Link href="/leads" className="text-xs underline">← Leads</Link>
      <div className="mt-2 flex items-start justify-between gap-2">
        <h1 className="text-2xl font-bold leading-tight">{lead.name}</h1>
        <span className={`badge ${STATUS_COLORS[lead.status] ?? ""}`}>{lead.status}</span>
      </div>

      <div className="card mt-3 space-y-1 text-sm">
        <div>Email: {lead.email ?? "—"}</div>
        <div>Phone: {lead.phone ?? "—"}</div>
        <div className="break-all">Website: {lead.website ? <a className="underline" href={/^https?:/.test(lead.website) ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer">{lead.website}</a> : "—"}</div>
        <div>Address: {lead.address ?? "—"}</div>
        <div>{lead.niche} · {lead.city}</div>
        {lead.previewUrl && <div className="break-all">Preview: <a className="font-semibold text-gold underline" href={lead.previewUrl} target="_blank" rel="noreferrer">{lead.previewUrl}</a></div>}
        {lead.finalUrl && <div className="break-all">Final: <a className="font-semibold text-gold underline" href={lead.finalUrl} target="_blank" rel="noreferrer">{lead.finalUrl}</a></div>}
        <div className="flex items-center gap-2 pt-2">
          <span className="text-xs">Status</span>
          <StatusSelect id={lead.id} status={lead.status} />
        </div>
      </div>

      {(facts.description || facts.colors?.length) && (
        <div className="card mt-3 text-sm">
          <div className="text-xs font-bold uppercase text-slate-600">Scraped facts</div>
          {facts.description && <p className="mt-1">{facts.description}</p>}
          {facts.headings && facts.headings.length > 0 && <p className="mt-1 text-xs text-slate-600">{facts.headings.slice(0, 6).join(" · ")}</p>}
          <div className="mt-2 flex items-center gap-2">
            {facts.colors?.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 text-xs">
                <span className="inline-block h-4 w-4 rounded border border-line" style={{ background: c }} />
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      <h2 className="mt-5 text-xl font-bold">Actions</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton label={lead.previewUrl ? "Regenerate sample" : "Generate sample site"} path="lead" body={{ action: "sample", id }} variant="ghost" refresh={false} />
        <ActionButton label="Write pitch" path="lead" body={{ action: "pitch", id }} variant="ghost" refresh={false} />
        <ActionButton label="Create deposit link / details" path="lead" body={{ action: "deposit", id }} variant="ghost" refresh />
        {!depositPaid && <ActionButton label="Mark deposit as paid" path="lead" body={{ action: "markpaid", id, kind: "deposit" }} confirm="Confirm you received the deposit? This builds and delivers the FINAL site." variant="gold" />}
        {depositPaid && <ActionButton label="Rebuild final site" path="lead" body={{ action: "final", id }} variant="ghost" refresh={false} />}
        {depositPaid && lead.finalUrl && <ActionButton label="Draft handover + balance email" path="lead" body={{ action: "handover", id }} variant="ghost" />}
        {depositPaid && !finalPaid && <ActionButton label="Mark final balance paid" path="lead" body={{ action: "markpaid", id, kind: "final" }} confirm="Confirm the final balance was received?" variant="ghost" />}
        <ActionButton label="Delete lead" path="lead" body={{ action: "delete", id }} confirm="Delete this lead and everything attached?" variant="danger" redirect="/leads" />
      </div>

      {depositPaid && (
        <div className="card mt-4 border-gold">
          <h2 className="text-xl font-bold">Delivery steps</h2>
          {!lead.finalUrl && <p className="mt-1 text-sm text-amber-800">The final site is still building ({finalSite?.status ?? "queued"}). Check Activity if this takes more than a few minutes.</p>}
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            <li>Open the final link above and review every page on your phone.</li>
            <li>
              Ask the client for real details and replace each <b>[sample]</b> item (photos, fees, testimonials). Download the HTML from the Sites tab (“View HTML”), edit, then re-upload in Netlify → Deploys.
            </li>
            <li>
              <b>Connect the domain:</b> Netlify → Sites → <b>{netlifyName || "the client site"}</b> → Domain management → Add a domain.
            </li>
            <li>
              At the registrar DNS: apex record <b>A → 75.2.60.5</b>, and <b>www CNAME → {netlifyName ? `${netlifyName}.netlify.app` : "[site].netlify.app"}</b> (or switch to Netlify DNS).
            </li>
            <li>When DNS propagates (up to 24h), Netlify → HTTPS → Verify DNS → Provision certificate.</li>
            <li>Send the handover message below, collect the final balance, then transfer the site or hand over the files.</li>
          </ol>
          <div className="mt-3">
            <div className="text-xs font-bold uppercase text-slate-600">Handover message</div>
            <CopyBox text={handover} label="Copy message" />
          </div>
        </div>
      )}

      <h2 className="mt-5 text-xl font-bold">Sites</h2>
      {siteRows.map((s) => (
        <div key={s.id} className="card mt-2 text-sm">
          <div className="flex justify-between">
            <b className="capitalize">{s.kind}</b>
            <span className="badge">{s.status}</span>
          </div>
          {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-gold underline">{s.url}</a>}
          {s.notes && <p className="mt-1 text-xs text-slate-600">{s.notes}</p>}
        </div>
      ))}
      {!siteRows.length && <p className="text-sm text-slate-600">No sites yet.</p>}

      <h2 className="mt-5 text-xl font-bold">Payments</h2>
      {pays.map((p) => (
        <div key={p.id} className="card mt-2 flex items-center justify-between text-sm">
          <div>
            <b className="capitalize">{p.kind}</b> · {naira(p.amount)}
            <div className="text-xs text-slate-600">{p.mode}{p.paystackMode ? ` (${p.paystackMode})` : ""} · {fmtDate(p.paidAt ?? p.createdAt)}</div>
          </div>
          <span className={`badge ${p.status === "paid" ? "bg-emerald-100 text-emerald-900" : ""}`}>{p.status}</span>
        </div>
      ))}
      {!pays.length && <p className="text-sm text-slate-600">No payments yet.</p>}

      <h2 className="mt-5 text-xl font-bold">Emails</h2>
      <div className="space-y-2 pb-4">
        {msgs.map((m) => (
          <div key={m.id} className={`rounded-lg border p-3 text-sm ${m.direction === "in" ? "border-gold bg-white" : "border-line bg-[#fffdf8]"}`}>
            <div className="flex justify-between text-xs text-slate-600">
              <span>{m.direction === "in" ? "Received" : m.kind} · {m.status}{m.classification ? ` · ${m.classification}` : ""}</span>
              <span>{fmtDate(m.sentAt ?? m.createdAt)}</span>
            </div>
            <div className="mt-1 font-semibold">{m.subject}</div>
            <div className="mt-1 whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
        {!msgs.length && <p className="text-sm text-slate-600">No emails yet.</p>}
      </div>
    </div>
  );
}
