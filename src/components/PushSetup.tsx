"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

function b64ToUint8(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function PushSetup() {
  const [state, setState] = useState<"unknown" | "unsupported" | "off" | "on" | "denied">("unknown");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const { key } = (await api("push/key")) as { key: string };
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) });
      await api("push/subscribe", sub.toJSON());
      setState("on");
      setMsg("Notifications enabled on this phone.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await api("push/test", {});
      setMsg("Test sent. It should arrive in a few seconds.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-slate-700">Get a push for new replies, interested leads, payments and errors.</p>
      {state === "unsupported" && <p className="mt-2 text-sm text-red-700">This browser does not support push. Open SiteReach in Chrome on Android (installed to home screen works best).</p>}
      {state === "denied" && <p className="mt-2 text-sm text-red-700">Notifications are blocked. In Chrome: site settings → Notifications → Allow, then reload.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {state === "off" && (
          <button className="btn" disabled={busy} onClick={enable}>
            Enable notifications
          </button>
        )}
        {state === "on" && (
          <button className="btn btn-ghost" disabled={busy} onClick={test}>
            Send test notification
          </button>
        )}
      </div>
      {state === "on" && <p className="mt-2 text-xs text-emerald-800">Notifications are on for this device.</p>}
      {msg && <p className="mt-2 text-xs">{msg}</p>}
    </div>
  );
}
