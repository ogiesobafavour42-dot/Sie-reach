import { handleWebhook } from "@/lib/closing";
import { errMsg, log } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const r = await handleWebhook(raw, req.headers.get("x-paystack-signature"));
    return new Response(r.body, { status: r.status });
  } catch (e) {
    await log("error", "webhook", errMsg(e));
    return new Response("error", { status: 500 });
  }
}
