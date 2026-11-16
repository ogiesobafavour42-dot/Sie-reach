import { cookies } from "next/headers";
import { verifySession } from "./crypto";

export const COOKIE = "sr_session";

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get(COOKIE)?.value);
}
