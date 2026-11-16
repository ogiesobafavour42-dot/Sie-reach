import { fetchRetry } from "./http";
import { getSettings } from "./settings";
import { scrub } from "./log";

const FALLBACK_MODEL = "gemini-2.5-flash";

type Opts = { system?: string; json?: boolean; maxTokens?: number; temperature?: number; timeoutMs?: number };

async function call(model: string, key: string, prompt: string, o: Opts): Promise<{ status: number; text: string }> {
  const body = {
    ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: o.temperature ?? 0.7,
      maxOutputTokens: o.maxTokens ?? 8192,
      ...(o.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const res = await fetchRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    },
    { timeoutMs: o.timeoutMs ?? 120000, retries: 3, backoffMs: 3000 },
  );
  return { status: res.status, text: await res.text() };
}

/** Calls Gemini. Key is read server-side from encrypted settings. */
export async function gemini(prompt: string, o: Opts = {}): Promise<string> {
  const s = await getSettings(["gemini_key", "gemini_model"]);
  if (!s.gemini_key) throw new Error("Gemini API key is not set (Settings → API keys).");
  let r = await call(s.gemini_model, s.gemini_key, prompt, o);
  if (r.status === 404 && s.gemini_model !== FALLBACK_MODEL) {
    r = await call(FALLBACK_MODEL, s.gemini_key, prompt, o);
  }
  if (r.status !== 200) throw new Error(scrub(`Gemini HTTP ${r.status}: ${r.text.slice(0, 250)}`));
  let data: { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
  try {
    data = JSON.parse(r.text);
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }
  const parts = data.candidates?.[0]?.content?.parts;
  const text = (parts ?? []).map((p) => p.text ?? "").join("");
  if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason ?? "empty"})`);
  return text;
}

export function stripFences(t: string) {
  return t
    .replace(/^\s*```[a-zA-Z]*\s*\n/, "")
    .replace(/\n```\s*$/, "")
    .trim();
}

export async function geminiJson<T>(prompt: string, o: Opts = {}): Promise<T> {
  const t = stripFences(await gemini(prompt, { ...o, json: true }));
  try {
    return JSON.parse(t) as T;
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("Gemini did not return valid JSON");
  }
}
