export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const STATUS_COLORS: Record<string, string> = {
  new: "bg-slate-200 text-slate-800",
  pitched: "bg-sky-100 text-sky-900",
  replied: "bg-amber-100 text-amber-900",
  interested: "bg-emerald-100 text-emerald-900",
  paid: "bg-emerald-700 text-white",
  dead: "bg-red-100 text-red-900",
};

export const thumb = (url: string) => `https://image.thum.io/get/width/420/crop/640/noanimate/${url}`;
