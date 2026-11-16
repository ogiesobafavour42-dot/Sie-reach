import crypto from "node:crypto";
import { fetchRetry, sleep } from "./http";
import { getSetting } from "./settings";

const API = "https://api.netlify.com/api/v1";

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "site";

/** Deploys a set of files to Netlify (creating the site when siteId is missing). */
export async function deployFiles(
  files: Record<string, string>,
  nameHint: string,
  siteId?: string | null,
): Promise<{ siteId: string; url: string }> {
  const token = await getSetting("netlify_token");
  if (!token) throw new Error("Netlify token is not set (Settings → API keys).");
  const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  let url = "";
  if (!siteId) {
    const name = `sr-${slug(nameHint)}-${crypto.randomBytes(2).toString("hex")}`;
    const r = await fetchRetry(`${API}/sites`, { method: "POST", headers: H, body: JSON.stringify({ name }) }, { timeoutMs: 30000, retries: 2 });
    if (!r.ok) throw new Error(`Netlify create site HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { id: string; ssl_url?: string; url?: string; name: string };
    siteId = j.id;
    url = j.ssl_url || j.url || `https://${j.name}.netlify.app`;
  }

  const digest: Record<string, string> = {};
  const byHash: Record<string, string> = {};
  for (const [p, content] of Object.entries(files)) {
    const h = crypto.createHash("sha1").update(content).digest("hex");
    digest["/" + p] = h;
    byHash[h] = p;
  }
  const d = await fetchRetry(`${API}/sites/${siteId}/deploys`, { method: "POST", headers: H, body: JSON.stringify({ files: digest }) }, { timeoutMs: 30000, retries: 2 });
  if (!d.ok) throw new Error(`Netlify deploy HTTP ${d.status}: ${(await d.text()).slice(0, 200)}`);
  const dj = (await d.json()) as { id: string; required?: string[]; ssl_url?: string; url?: string };
  if (!url) url = dj.ssl_url || dj.url || "";

  for (const h of dj.required ?? []) {
    const p = byHash[h];
    if (!p) continue;
    const u = await fetchRetry(
      `${API}/deploys/${dj.id}/files/${p.split("/").map(encodeURIComponent).join("/")}`,
      { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: files[p] },
      { timeoutMs: 45000, retries: 3 },
    );
    if (!u.ok) throw new Error(`Netlify upload ${p} HTTP ${u.status}`);
    await u.text().catch(() => "");
  }

  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    try {
      const st = await fetchRetry(`${API}/deploys/${dj.id}`, { headers: H }, { timeoutMs: 15000, retries: 1 });
      const sj = (await st.json()) as { state?: string; error_message?: string };
      if (sj.state === "ready") break;
      if (sj.state === "error") throw new Error(`Netlify deploy error: ${sj.error_message ?? "unknown"}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Netlify deploy error")) throw e;
    }
  }
  return { siteId: siteId!, url };
}
