import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { fetchRetry, sleep, UA } from "./http";
import { getSettings } from "./settings";
import { errMsg, log } from "./log";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function overpass(query: string): Promise<{ elements: OsmEl[] }> {
  let last = "";
  for (let i = 0; i < 6; i++) {
    const url = MIRRORS[i % MIRRORS.length];
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 75000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": UA, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: "data=" + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) return (await res.json()) as { elements: OsmEl[] };
      last = `${new URL(url).host} HTTP ${res.status}`;
      await res.text().catch(() => "");
    } catch (e) {
      clearTimeout(t);
      last = `${new URL(url).host} ${errMsg(e)}`;
    }
    await sleep(1500 * (i + 1));
  }
  throw new Error(`Overpass failed on all mirrors (${last})`);
}

type OsmEl = { type: string; id: number; tags?: Record<string, string> };

function filtersFor(niche: string): string[] {
  const n = niche.toLowerCase();
  const priv = /private/.test(n) ? '["operator:type"!~"public|government|state"]' : "";
  if (/school|nursery|academy|college|kindergarten/.test(n)) return [`["amenity"~"^(school|kindergarten|college)$"]${priv}`];
  if (/restaurant|cafe|eatery/.test(n)) return ['["amenity"~"^(restaurant|cafe|fast_food)$"]'];
  if (/hotel|guest|lodge/.test(n)) return ['["tourism"~"^(hotel|guest_house|hostel)$"]'];
  if (/clinic|hospital|dental|dentist|doctor/.test(n)) return ['["amenity"~"^(clinic|hospital|dentist|doctors)$"]'];
  if (/pharmac/.test(n)) return ['["amenity"="pharmacy"]'];
  if (/salon|barber|beauty|spa/.test(n)) return ['["shop"~"^(hairdresser|beauty)$"]'];
  if (/gym|fitness/.test(n)) return ['["leisure"="fitness_centre"]'];
  if (/law|lawyer|solicitor/.test(n)) return ['["office"="lawyer"]'];
  if (/real estate|estate agent|property/.test(n)) return ['["office"="estate_agent"]'];
  if (/bakery/.test(n)) return ['["shop"="bakery"]'];
  const words = n.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join("|");
  return [`["name"~"${words || "business"}",i]`];
}

const esc = (s: string) => s.replace(/["\\]/g, "");
const CONTACT = '[~"^(website|contact:website|url|email|contact:email)$"~"."]';

const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|example\.|sentry|wixpress|domain\.com|your(name|email)|@email\.|noreply|no-reply|u003e/i;

export function extractEmails(html: string, host: string): string[] {
  const found = new Map<string, number>();
  const text = decodeURIComponent(html.replace(/%(?![0-9a-f]{2})/gi, "%25")).replace(/&#64;|\[at\]|\(at\)/gi, "@");
  const re = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
  for (const m of text.matchAll(re)) {
    const e = m[0].toLowerCase();
    if (BAD_EMAIL.test(e)) continue;
    let score = 1;
    if (host && e.endsWith(host.replace(/^www\./, ""))) score += 3;
    if (/^(info|contact|admissions|hello|office|enquir|admin|bursar|principal)/.test(e)) score += 2;
    if (new RegExp(`mailto:${e.replace(/[.+]/g, "\\$&")}`, "i").test(text)) score += 2;
    found.set(e, (found.get(e) ?? 0) + score);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
}

async function getHtml(u: string): Promise<string | null> {
  try {
    const r = await fetchRetry(u, { headers: { "User-Agent": UA, accept: "text/html" }, redirect: "follow" }, { timeoutMs: 9000, retries: 1 });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    return (await r.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

function abs(src: string | undefined, base: string) {
  if (!src) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

function clean(s: string) {
  return s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topColors(html: string): string[] {
  const counts = new Map<string, number>();
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-f]{6})["']/i)?.[1];
  if (theme) counts.set(theme.toLowerCase(), 50);
  const css = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join(" ") + (html.match(/style=["'][^"']+["']/gi) || []).join(" ");
  for (const m of css.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = m[1].toLowerCase();
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 30) continue; // greys
    counts.set("#" + hex, (counts.get("#" + hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
}

export type Scraped = {
  email?: string;
  facts: {
    title?: string;
    description?: string;
    headings?: string[];
    text?: string;
    logo?: string | null;
    colors?: string[];
    address?: string;
    phones?: string[];
  };
};

export async function scrapeSite(website: string): Promise<Scraped> {
  const base = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  let host = "";
  try {
    host = new URL(base).hostname;
  } catch {
    return { facts: {} };
  }
  const home = await getHtml(base);
  const contact = (await getHtml(new URL("/contact", base).toString())) ?? (await getHtml(new URL("/contact-us", base).toString()));
  const all = [home, contact].filter(Boolean) as string[];
  if (!all.length) return { facts: {} };
  const emails = extractEmails(all.join("\n"), host);
  const h = home ?? all[0];
  const title = clean(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? h.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const headings = [...h.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => clean(m[1])).filter((t) => t.length > 3 && t.length < 120).slice(0, 12);
  const og = h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const logoImg = [...h.matchAll(/<img[^>]+>/gi)].map((m) => m[0]).find((t) => /logo/i.test(t));
  const logoSrc = logoImg?.match(/src=["']([^"']+)["']/i)?.[1];
  const icon = h.match(/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1];
  const ld = [...h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(" ");
  const street = ld.match(/"streetAddress"\s*:\s*"([^"]+)"/)?.[1];
  const locality = ld.match(/"addressLocality"\s*:\s*"([^"]+)"/)?.[1];
  const phones = [...new Set([...all.join(" ").matchAll(/tel:([+\d][\d\s\-()]{6,18})/gi)].map((m) => m[1].trim()))].slice(0, 3);
  const text = clean(h).slice(0, 700);
  return {
    email: emails[0],
    facts: {
      title,
      description,
      headings,
      text,
      logo: abs(logoSrc ?? og ?? icon, base),
      colors: topColors(h),
      address: [street, locality].filter(Boolean).join(", ") || undefined,
      phones,
    },
  };
}

export async function findLeads(): Promise<number> {
  const s = await getSettings(["niche", "city", "max_leads_per_run"]);
  const niche = s.niche.trim() || "private schools";
  const city = esc(s.city.trim() || "Lagos");
  const max = Math.min(40, Math.max(1, parseInt(s.max_leads_per_run) || 15));
  const union = filtersFor(niche).map((f) => `nwr${f}["name"]${CONTACT}(area.a);`).join("\n");
  let data: { elements: OsmEl[] } | null = null;
  for (const areaQ of [`area["name"="${city}"]["boundary"="administrative"]->.a;`, `area["name"="${city}"]->.a;`]) {
    data = await overpass(`[out:json][timeout:60];\n${areaQ}\n(\n${union}\n);\nout tags center 250;`);
    if (data.elements.length) break;
  }
  const els = data?.elements ?? [];
  await log("info", "leads", `Overpass returned ${els.length} businesses for "${niche}" in ${city}`);

  const existing = await db.select({ osm: leads.osmId, w: leads.website, e: leads.email, n: leads.name }).from(leads);
  const osmSeen = new Set(existing.map((x) => x.osm));
  const hostOf = (w?: string | null) => {
    try {
      return w ? new URL(/^https?:/i.test(w) ? w : `https://${w}`).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  };
  const hostSeen = new Set(existing.map((x) => hostOf(x.w)).filter(Boolean));
  const emailSeen = new Set(existing.map((x) => x.e?.toLowerCase()).filter(Boolean) as string[]);
  const nameSeen = new Set(existing.map((x) => x.n.toLowerCase()));

  let added = 0;
  const queue = els.filter((e) => e.tags?.name);
  let idx = 0;
  const worker = async () => {
    while (added < max) {
      const el = queue[idx++];
      if (!el) return;
      const t = el.tags!;
      const osmId = `${el.type}/${el.id}`;
      const website = t.website || t["contact:website"] || t.url || null;
      const h = hostOf(website);
      const tagEmail = (t.email || t["contact:email"] || "").split(";")[0].trim().toLowerCase() || null;
      if (osmSeen.has(osmId) || (h && hostSeen.has(h)) || nameSeen.has(t.name.toLowerCase())) continue;
      osmSeen.add(osmId);
      if (h) hostSeen.add(h);
      nameSeen.add(t.name.toLowerCase());
      let email = tagEmail;
      let facts: Scraped["facts"] = {};
      if (website) {
        try {
          const sc = await scrapeSite(website);
          facts = sc.facts;
          email = email || sc.email || null;
        } catch (e) {
          await log("warn", "leads", `Scrape failed for ${t.name}: ${errMsg(e)}`);
        }
      }
      if (email && emailSeen.has(email)) continue;
      if (email) emailSeen.add(email);
      const addr = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"] || t["addr:city"]].filter(Boolean).join(" ") || facts.address || null;
      const phone = (t.phone || t["contact:phone"] || facts.phones?.[0] || "").split(";")[0].trim() || null;
      try {
        await db
          .insert(leads)
          .values({
            osmId,
            name: t.name,
            website,
            email,
            phone,
            address: addr,
            city: s.city,
            niche,
            facts: JSON.stringify({ ...facts, osmTags: { description: t.description, opening_hours: t.opening_hours, "operator:type": t["operator:type"] } }),
          })
          .onConflictDoNothing();
        added++;
      } catch (e) {
        await log("warn", "leads", `Could not save ${t.name}: ${errMsg(e)}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const total = (await db.select({ c: sql<number>`count(*)::int` }).from(leads).where(eq(leads.status, "new")))[0].c;
  await log("info", "leads", `Added ${added} new leads (${total} waiting)`);
  return added;
}
