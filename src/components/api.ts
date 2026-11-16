"use client";

export type ApiResult = Record<string, unknown> & { error?: string; message?: string; text?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch wrapper tolerant of slow/unstable mobile connections: timeout + retry on network failure. */
export async function api<T = ApiResult>(path: string, body?: unknown, o: { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  const { retries = 2, timeoutMs = 45000 } = o;
  let lastErr = "Network error";
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`/api/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
        credentials: "same-origin",
      });
      clearTimeout(t);
      if ([502, 503, 504].includes(res.status) && i < retries) {
        await sleep(1500 * (i + 1));
        continue;
      }
      const j = (await res.json().catch(() => ({}))) as ApiResult;
      if (res.status === 401 && path !== "login" && path !== "session") {
        window.location.href = "/login";
        throw new Error("Signed out");
      }
      if (!res.ok) throw Object.assign(new Error(j.error || `Request failed (${res.status})`), { final: true });
      return j as T;
    } catch (e) {
      clearTimeout(t);
      if ((e as { final?: boolean }).final) throw e;
      lastErr = e instanceof DOMException && e.name === "AbortError" ? "Connection timed out" : e instanceof Error ? e.message : "Network error";
      if (i < retries) await sleep(1500 * (i + 1));
    }
  }
  throw new Error(`${lastErr}. Check your connection and try again.`);
}
