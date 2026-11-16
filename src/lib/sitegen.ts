import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, payments, sites } from "@/db/schema";
import { gemini, stripFences } from "./gemini";
import { deployFiles } from "./netlify";
import { getSettings } from "./settings";
import { errMsg, log } from "./log";
import { notify } from "./push";

export const DESIGN_BRIEF = `DESIGN BRIEF
- Style: refined, editorial, trustworthy. Think elite private school or boutique agency, not a tech startup.
- Typography: Google Fonts only. Headings in an elegant serif (Playfair Display or Cormorant Garamond). Body in a clean sans (Inter or DM Sans). Generous line height, large headings, strong hierarchy.
- Colors: restrained palette of 3 colors max. Deep navy or forest green, warm ivory/off-white background, one muted gold or bronze accent. Use the business's own logo colors if found.
- Strictly NO: neon colors, purple-to-blue gradients, glowing effects, glassmorphism, emojis, rocket/sparkle icons, robot imagery, generic startup look, or hype words like "revolutionize", "unleash", "elevate".
- Layout: lots of whitespace, full-width hero with strong headline, thin divider lines, subtle fade-in on scroll only, sharp or slightly rounded corners (4-8px). Sections: About, Programs/Services, Admissions/Booking, Facilities, Testimonials, Contact.
- Copy: calm, specific, customer-focused. Use the real business name, area and scraped facts. Mark any invented detail as [sample].
- Mobile-first, fast, single self-contained HTML file with inline CSS, accessible contrast, sticky Apply/Contact button on mobile, WhatsApp click-to-chat button using the business phone number.`;

const SYSTEM =
  "You are a senior art director and front-end developer at a boutique studio. You write hand-crafted, restrained, premium websites that never look machine-generated. You output only what is asked, with no commentary and no markdown fences.";

type Lead = typeof leads.$inferSelect;

export function waNumber(phone?: string | null) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "234" + d.slice(1);
  if (d.length === 10) d = "234" + d;
  return d.length >= 11 ? d : null;
}

const BANNED_WORDS = /revolutioni[sz]e|unleash|elevate|supercharge|game[- ]chang|cutting[- ]edge|seamless/gi;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;

export function lint(html: string): string[] {
  const v: string[] = [];
  if (EMOJI.test(html)) v.push("Contains emoji characters");
  EMOJI.lastIndex = 0;
  const bw = html.match(BANNED_WORDS);
  if (bw) v.push(`Contains hype words: ${[...new Set(bw.map((x) => x.toLowerCase()))].join(", ")}`);
  if (/backdrop-filter/i.test(html)) v.push("Uses backdrop-filter (glassmorphism)");
  if (/linear-gradient[^;]*(purple|violet|#[6-9a-f][0-9a-f]?[0-4][0-9a-f]{2}[c-f][0-9a-f])/i.test(html)) v.push("Possible purple/blue gradient");
  if (/box-shadow[^;]*0 0 \d+px/i.test(html) || /text-shadow[^;]*0 0/i.test(html)) v.push("Possible glow effect (box-shadow 0 0 blur)");
  if (!/fonts\.googleapis\.com/i.test(html)) v.push("Google Fonts link missing");
  if (!/Playfair|Cormorant/i.test(html)) v.push("Heading serif font (Playfair Display or Cormorant Garamond) missing");
  if (!/name=["']viewport["']/i.test(html)) v.push("Viewport meta tag missing");
  if (!/<\/html>/i.test(html)) v.push("HTML is not closed");
  const hex = new Set((html.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).map((x) => x.toLowerCase()));
  if (hex.size > 9) v.push(`Too many distinct colours (${hex.size}); keep to 3 colours plus tints`);
  return v;
}

export function sanitize(html: string) {
  return html.replace(EMOJI, "").replace(/backdrop-filter\s*:[^;}"]+;?/gi, "").replace(/-webkit-backdrop-filter\s*:[^;}"]+;?/gi, "");
}

function leadContext(lead: Lead, owner: Record<string, string>) {
  let facts: Record<string, unknown> = {};
  try {
    facts = JSON.parse(lead.facts);
  } catch {}
  const wa = waNumber(lead.phone);
  return `BUSINESS
Name: ${lead.name}
Type: ${lead.niche ?? "local business"}
Area/City: ${lead.city ?? ""}
Address: ${lead.address ?? "(not found)"}
Phone: ${lead.phone ?? "(not found)"}
Email: ${lead.email ?? "(not found)"}
Current website: ${lead.website ?? "(none)"}
WhatsApp chat link: ${wa ? `https://wa.me/${wa}` : "(no number found: omit the WhatsApp button, keep a Call/Contact button)"}
Scraped facts (JSON): ${JSON.stringify(facts).slice(0, 3500)}
Brand colours found: ${(facts.colors as string[] | undefined)?.join(", ") || "none, use deep navy + ivory + muted gold"}
Logo URL found: ${(facts.logo as string | undefined) ?? "none (use a typographic wordmark)"}
Site built by: ${owner.owner_name}, ${owner.owner_phone}`;
}

function extractHtml(t: string) {
  let h = stripFences(t);
  const i = h.search(/<!doctype html/i);
  if (i > 0) h = h.slice(i);
  return h;
}

const FINAL_PAGES = ["index.html", "about.html", "programs.html", "admissions.html", "contact.html"];

function parseFiles(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = stripFences(t).split(/^=== FILE: ([\w.-]+) ===\s*$/m);
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = extractHtml(parts[i + 1] ?? "");
  return out;
}

async function qualityPass(name: string, html: string): Promise<{ html: string; notes: string }> {
  const issues = lint(html);
  const prompt = `${DESIGN_BRIEF}

You are the quality reviewer. Critique the web page below against this brief: fonts, colours (3 max, business colours if known), banned elements (neon, purple-blue gradients, glow, glassmorphism, emoji, rocket/sparkle/robot imagery, hype words), layout, mobile behaviour (sticky Apply/Contact button, readable at 360px, no horizontal scroll), accessible contrast, and the [sample] marking of invented details.
Automatic checks flagged: ${issues.length ? issues.join("; ") : "nothing"}.
Fix every violation directly in the code and keep everything else. Keep it one self-contained HTML file with inline CSS. Output ONLY the corrected complete HTML document, starting with <!DOCTYPE html>.

PAGE (${name}):
${html}`;
  try {
    const out = extractHtml(await gemini(prompt, { system: SYSTEM, maxTokens: 30000, temperature: 0.3, timeoutMs: 180000 }));
    if (/<\/html>/i.test(out) && out.length > html.length * 0.5) {
      return { html: sanitize(out), notes: `QA fixed: ${issues.length ? issues.join("; ") : "no automatic flags"}` };
    }
    return { html: sanitize(html), notes: "QA output unusable, kept first pass (sanitised)" };
  } catch (e) {
    return { html: sanitize(html), notes: `QA failed (${errMsg(e)}), kept first pass (sanitised)` };
  }
}

export async function generateSite(leadId: number, kind: "sample" | "final") {
  const lead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
  if (!lead) throw new Error("Lead not found");

  if (kind === "final") {
    const paid = (await db.select().from(payments).where(and(eq(payments.leadId, leadId), eq(payments.kind, "deposit"), eq(payments.status, "paid"))))[0];
    if (!paid || (paid.mode === "paystack" && !paid.verified)) {
      throw new Error("Final site blocked: no verified/confirmed deposit for this lead.");
    }
  }

  const owner = await getSettings(["owner_name", "owner_phone"]);
  let site = (await db.select().from(sites).where(and(eq(sites.leadId, leadId), eq(sites.kind, kind))).orderBy(desc(sites.id)))[0];
  if (!site) {
    site = (await db.insert(sites).values({ leadId, kind, status: "building" }).returning())[0];
  } else {
    await db.update(sites).set({ status: "building", updatedAt: new Date() }).where(eq(sites.id, site.id));
  }
  await db.update(sites).set({ attempts: site.attempts + 1 }).where(eq(sites.id, site.id));

  try {
    await log("info", "sitegen", `Generating ${kind} site for ${lead.name}…`);
    const ctx = leadContext(lead, owner);
    let files: Record<string, string> = {};
    let notes: string[] = [];

    if (kind === "sample") {
      const prompt = `${DESIGN_BRIEF}

Create the SAMPLE website for this business: a single self-contained HTML file with inline CSS and a small inline script for the fade-in only. Include all six sections (About, Programs/Services, Admissions/Booking, Facilities, Testimonials, Contact), a footer, a sticky Apply/Contact bar on mobile, and the WhatsApp button if a link is given. Use only the Google Fonts link for external resources, plus the logo URL if one was found (with a typographic fallback). No stock-photo URLs: use solid colour blocks, thin rules and typography instead of imagery. Testimonials and any invented figures must be marked [sample]. Add a small discreet line in the footer: "Sample design prepared by ${owner.owner_name}".

${ctx}

Output ONLY the complete HTML document, starting with <!DOCTYPE html>.`;
      const html = extractHtml(await gemini(prompt, { system: SYSTEM, maxTokens: 30000, timeoutMs: 180000 }));
      if (!/<\/html>/i.test(html)) throw new Error("Gemini returned an incomplete HTML page");
      const q = await qualityPass("index.html", html);
      files = { "index.html": q.html };
      notes.push(q.notes);
    } else {
      const prompt = `${DESIGN_BRIEF}

Create the FINAL, more complete website for this business as a small multi-page site. Pages: ${FINAL_PAGES.join(", ")}. Each page is a self-contained HTML file with inline CSS (repeat the same CSS in every page so they look identical), shared header navigation linking the pages with relative links, footer, sticky Apply/Contact bar on mobile, WhatsApp button where a link is given. index.html covers the overview with all sections (About, Programs/Services, Admissions/Booking, Facilities, Testimonials, Contact summary); the other pages go deeper. Add a simple contact form block that uses a mailto: link to the business email if present. Include <title>, meta description, and Open Graph tags. Invented details must still be marked [sample] so the owner can replace them with real information.

${ctx}

OUTPUT FORMAT (strict): for each page output a line "=== FILE: <filename> ===" followed by the complete HTML document. No other text.`;
      const raw = await gemini(prompt, { system: SYSTEM, maxTokens: 60000, timeoutMs: 240000 });
      const parsed = parseFiles(raw);
      if (!parsed["index.html"]) throw new Error("Gemini did not return index.html in the expected format");
      for (const [p, html] of Object.entries(parsed)) {
        if (!/<\/html>/i.test(html)) {
          notes.push(`${p}: incomplete, dropped`);
          continue;
        }
        const q = await qualityPass(p, html);
        files[p] = q.html;
        notes.push(`${p}: ${q.notes}`);
      }
      if (!files["index.html"]) throw new Error("Final index.html was incomplete");
    }

    await db.update(sites).set({ files: JSON.stringify(files), notes: notes.join(" | ").slice(0, 1500), updatedAt: new Date() }).where(eq(sites.id, site.id));

    try {
      const dep = await deployFiles(files, lead.name, site.netlifySiteId);
      await db.update(sites).set({ status: "live", url: dep.url, netlifySiteId: dep.siteId, updatedAt: new Date() }).where(eq(sites.id, site.id));
      await db.update(leads).set(kind === "sample" ? { previewUrl: dep.url } : { finalUrl: dep.url }).where(eq(leads.id, leadId));
      await log("info", "sitegen", `${kind} site for ${lead.name} live at ${dep.url}`);
      if (kind === "final") await notify("Final site ready", `${lead.name}: ${dep.url}`, `/leads/${leadId}`);
    } catch (e) {
      await db.update(sites).set({ status: "undeployed", updatedAt: new Date() }).where(eq(sites.id, site.id));
      throw new Error(`Site generated but deploy failed: ${errMsg(e)}`);
    }
  } catch (e) {
    await db.update(sites).set({ status: site.status === "live" ? "live" : "failed", updatedAt: new Date() }).where(eq(sites.id, site.id));
    await log("error", "sitegen", `${kind} site for ${lead.name}: ${errMsg(e)}`);
    throw e;
  }
}
