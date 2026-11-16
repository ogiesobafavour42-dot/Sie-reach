import { getSettings } from "./settings";
import { kick, SCHEDULE } from "./jobs";
import { log, errMsg } from "./log";

const g = globalThis as typeof globalThis & { __srSched?: boolean };

export async function tick() {
  const keys = ["kill_switch", ...SCHEDULE.map((s) => s.toggle), ...SCHEDULE.map((s) => `lastrun_${s.name}`)];
  const s = await getSettings(keys);
  const kill = s.kill_switch === "1";
  for (const j of SCHEDULE) {
    if (s[j.toggle] !== "1") continue;
    if (kill && j.name === "send") continue;
    const last = parseInt(s[`lastrun_${j.name}`]) || 0;
    if (Date.now() - last >= j.everyMin * 60_000) kick(j.name);
  }
}

export function startScheduler() {
  if (g.__srSched) return;
  g.__srSched = true;
  setTimeout(() => {
    tick().catch((e) => console.log("tick failed", errMsg(e)));
    setInterval(() => {
      tick().catch((e) => console.log("tick failed", errMsg(e)));
    }, 60_000);
  }, 20_000);
  void log("info", "system", "Scheduler started").catch(() => {});
}
