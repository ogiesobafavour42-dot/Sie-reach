import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activity } from "@/db/schema";
import { fmtDate } from "@/lib/ui";

export default async function Activity({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const { level } = await searchParams;
  const only = level === "error" || level === "warn";
  const rows = only ? await db.select().from(activity).where(eq(activity.level, level!)).orderBy(desc(activity.id)).limit(150) : await db.select().from(activity).orderBy(desc(activity.id)).limit(150);
  return (
    <div>
      <h1 className="text-3xl font-bold">Activity log</h1>
      <div className="mt-2 flex gap-2 text-xs">
        {[
          ["", "All"],
          ["warn", "Warnings"],
          ["error", "Errors"],
        ].map(([v, l]) => (
          <Link key={v} href={v ? `/activity?level=${v}` : "/activity"} className={`badge px-3 py-1.5 ${(level ?? "") === v ? "bg-navy text-ivory" : ""}`}>
            {l}
          </Link>
        ))}
      </div>
      <div className="mt-3 space-y-1.5 pb-4">
        {rows.map((a) => (
          <div key={a.id} className={`rounded border-l-4 bg-white px-3 py-2 text-xs ${a.level === "error" ? "border-red-600" : a.level === "warn" ? "border-amber-500" : "border-line"}`}>
            <span className="text-slate-500">{fmtDate(a.createdAt)} · {a.type} · {a.level}</span>
            <div className="break-words">{a.message}</div>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-600">Nothing logged.</p>}
      </div>
    </div>
  );
}
