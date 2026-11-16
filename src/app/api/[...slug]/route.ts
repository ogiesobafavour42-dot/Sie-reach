import { handler, type Ctx } from "@/lib/apirouter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = (req: Request, ctx: Ctx) => handler(req, ctx);
export const POST = (req: Request, ctx: Ctx) => handler(req, ctx);
