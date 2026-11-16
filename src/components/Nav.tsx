"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home" },
  { href: "/leads", label: "Leads" },
  { href: "/queue", label: "Queue" },
  { href: "/inbox", label: "Inbox" },
  { href: "/sites", label: "Sites" },
  { href: "/payments", label: "Pay" },
  { href: "/activity", label: "Log" },
  { href: "/settings", label: "Settings" },
];

export default function Nav({ queue, inbox }: { queue: number; inbox: number }) {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-navy pb-[env(safe-area-inset-bottom)] text-ivory">
      <ul className="flex overflow-x-auto">
        {items.map((i) => {
          const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
          const n = i.href === "/queue" ? queue : i.href === "/inbox" ? inbox : 0;
          return (
            <li key={i.href} className="min-w-[19%] flex-1">
              <Link href={i.href} className={`relative block px-1 py-3.5 text-center text-xs font-semibold ${active ? "border-t-2 border-gold text-white" : "border-t-2 border-transparent text-ivory/70"}`}>
                {i.label}
                {n > 0 && <span className="ml-1 rounded-full bg-gold px-1.5 py-0.5 text-[10px] text-white">{n}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
