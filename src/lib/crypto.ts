import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

let keyBuf: Buffer | null = null;

async function getKey(): Promise<Buffer> {
  if (keyBuf) return keyBuf;
  let secret = process.env.APP_SECRET;
  if (!secret) {
    const rows = await db.select().from(settings).where(eq(settings.key, "app_secret"));
    if (rows[0]) secret = rows[0].value;
    else {
      await db
        .insert(settings)
        .values({ key: "app_secret", value: crypto.randomBytes(32).toString("hex") })
        .onConflictDoNothing();
      const again = await db.select().from(settings).where(eq(settings.key, "app_secret"));
      secret = again[0].value;
    }
  }
  keyBuf = crypto.createHash("sha256").update(secret).digest();
  return keyBuf;
}

export async function encrypt(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export async function decrypt(blob: string): Promise<string> {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1") return "";
  const key = await getKey();
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString("hex")}:${h.toString("hex")}`;
}

export function checkPassword(pw: string, stored: string): boolean {
  const [s, h] = stored.split(":");
  if (!s || !h) return false;
  const calc = crypto.scryptSync(pw, Buffer.from(s, "hex"), 64);
  const want = Buffer.from(h, "hex");
  return calc.length === want.length && crypto.timingSafeEqual(calc, want);
}

export async function signSession(days = 30): Promise<string> {
  const key = await getKey();
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + days * 86400e3 })).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const key = await getKey();
  const calc = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  const a = Buffer.from(calc);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}
