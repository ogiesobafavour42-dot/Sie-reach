import { redirect } from "next/navigation";
import { eq, and, sql } from "drizzle-orm";
import type { ReactNode } from "react";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { isAuthed } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import Nav from "@/components/Nav";
import { KillSwitch } from "@/components/Toggles";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthed())) redirect("/login");
  const s = await getSettings(["kill_switch", "paystack_mode", "payment_mode", "paystack_secret", "owner_name"]);
  const [q] = await db.select({ c: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.direction, "out"), sql`${messages.status} in ('pending','failed')`));
  const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.kind, "reply"), eq(messages.status, "pending")));
  const keyMode = s.paystack_secret.startsWith("sk_live_") ? "live" : s.paystack_secret.startsWith("sk_test_") ? "test" : "";
  const killed = s.kill_switch === "1";

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-20">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-navy px-4 py-3 text-ivory">
        <div>
          <div className="font-serif text-xl font-bold leading-none">SiteReach</div>
          <div className="text-[11px] text-ivory/70">{s.owner_name}</div>
        </div>
        <KillSwitch on={killed} />
      </header>
      {killed && <div className="bg-red-700 px-4 py-2 text-center text-xs font-bold text-white">KILL SWITCH ON: no emails are being sent</div>}
      {s.payment_mode === "paystack" ? (
        s.paystack_mode === "live" ? (
          <div className="bg-emerald-800 px-4 py-1.5 text-center text-xs font-bold text-white">PAYSTACK LIVE MODE: real money{keyMode && keyMode !== "live" ? " · KEY MISMATCH (not a live key)" : ""}</div>
        ) : (
          <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-bold text-navy">PAYSTACK TEST MODE: no real money moves{keyMode && keyMode !== "test" ? " · KEY MISMATCH (not a test key)" : ""}</div>
        )
      ) : (
        <div className="bg-slate-700 px-4 py-1.5 text-center text-xs font-bold text-white">MANUAL BANK TRANSFER MODE</div>
      )}
      <main className="px-4 pt-4">{children}</main>
      <Nav queue={q.c} inbox={r.c} />
    </div>
  );
}
