export const UA = "SiteReach/1.0 (+https://sitereach.app; contact: owner) Mozilla/5.0";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RetryOpts = {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  retryOn?: number[];
};

/** fetch with per-attempt timeout, retries on network errors and transient HTTP codes. */
export async function fetchRetry(url: string, init: RequestInit = {}, opts: RetryOpts = {}): Promise<Response> {
  const { timeoutMs = 15000, retries = 2, backoffMs = 1200, retryOn = [408, 429, 500, 502, 503, 504] } = opts;
  let lastErr: unknown;
  let lastRes: Response | undefined;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      if (retryOn.includes(res.status) && i < retries) {
        lastRes = res;
        await res.text().catch(() => "");
        await sleep(backoffMs * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < retries) await sleep(backoffMs * (i + 1));
    }
  }
  if (lastRes) return lastRes;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
