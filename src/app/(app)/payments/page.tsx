import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, payments } from "@/db/schema";
import { naira } from "@/lib/closing";
import { fmtDate } from "@/lib/ui";
import ActionButton from "@/components/ActionButton";

export default async function Payments() {
  const rows = await db.select({ p: payments, name: leads.name }).from(payments).leftJoin(leads, eq(leads.id, payments.leadId)).orderBy(desc(payments.id)).limit(100);
  const earned = rows.filter((r) => r.p.status === "paid").reduce((a, r) => a + r.p.amount, 0);
  const pending = rows.filter((r) => r.p.status === "pending").reduce((a, r) => a + r.p.amount, 0);
  return (
    <div>
      <h1 className="text-3xl font-bold">Payments</h1>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="card">
          <div className="text-xs text-slate-600">Earned</div>
          <div className="font-serif text-2xl font-bold">{naira(earned)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-600">Awaiting</div>
          <div className="font-serif text-2xl font-bold">{naira(pending)}</div>
        </div>
      </div>
      <div className="mt-3 space-y-2 pb-4">
        {rows.map(({ p, name }) => (
          <div key={p.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Link href={`/leads/${p.leadId}`} className="font-semibold underline">{name}</Link>
                <div className="text-sm capitalize">{p.kind} · {naira(p.amount)}</div>
              </div>
              <span className={`badge ${p.status === "paid" ? "bg-emerald-100 text-emerald-900" : p.status === "failed" ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}>{p.status}</span>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {p.mode === "paystack" ? `Paystack ${p.paystackMode ?? ""}` : "Manual transfer"} · {fmtDate(p.paidAt ?? p.createdAt)}
              {p.verified ? " · verified with Paystack" : ""}
            </div>
            {p.status === "pending" && (
              <div className="mt-2 flex flex-wrap gap-2">
                {p.mode === "paystack" && <ActionButton label="Check with Paystack" path="payment" body={{ id: p.id, action: "verify" }} variant="ghost" small />}
                <ActionButton label="Mark as paid" path="payment" body={{ id: p.id, action: "markpaid" }} confirm="Confirm you received this money?" variant="gold" small />
              </div>
            )}
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-600">No payments yet. A deposit link is created automatically when a lead is interested.</p>}
      </div>
    </div>
  );
}
