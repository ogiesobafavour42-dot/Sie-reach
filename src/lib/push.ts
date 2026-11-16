import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubs } from "@/db/schema";
import { getSetting, setSetting } from "./settings";

export async function ensureVapid(): Promise<string> {
  let pub = await getSetting("vapid_public");
  let priv = await getSetting("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey;
    priv = k.privateKey;
    await setSetting("vapid_public", pub, false);
    await setSetting("vapid_private", priv, true);
  }
  webpush.setVapidDetails("mailto:owner@sitereach.app", pub, priv);
  return pub;
}

export async function notify(title: string, body: string, url = "/") {
  try {
    if ((await getSetting("notify_push")) !== "1") return;
    const subs = await db.select().from(pushSubs);
    if (!subs.length) return;
    await ensureVapid();
    const payload = JSON.stringify({ title, body, url });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: 3600,
            timeout: 15000,
          });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await db.delete(pushSubs).where(eq(pushSubs.endpoint, s.endpoint));
        }
      }),
    );
  } catch (e) {
    console.log("push failed", e instanceof Error ? e.message : e);
  }
}
