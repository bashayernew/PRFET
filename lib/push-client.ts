import { apiGet, apiPost } from "@/lib/api";

function urlB64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Registers the service worker and subscribes to push (best-effort; safe to call anytime).
export async function enablePush(token: string): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    // The key comes from the server at runtime — a build-time env var would be empty here.
    const res = await apiGet<{ key: string }>("/api/push/key");
    const key = res.ok && res.data?.key ? res.data.key : "";
    if (!key) return false;
    const reg = await navigator.serviceWorker.register("/sw.js");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
    await apiPost("/api/push/subscribe", sub.toJSON(), token);
    return true;
  } catch {
    return false;
  }
}
