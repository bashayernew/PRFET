import { apiPost } from "@/lib/api";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Register the installed (Capacitor) app for native FCM push, so notifications reach the
 * phone even when the app is closed. No-op on the plain web (there's no native plugin there;
 * web-push handles browsers separately). Safe to call on every app open / login.
 */
export async function registerNativePush(accessToken: string): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return; // only inside the installed app

    const mod: any = await import("@capacitor/push-notifications");
    const Push = mod.PushNotifications;
    if (!Push) return;

    let perm = await Push.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await Push.requestPermissions();
    }
    if (perm.receive !== "granted") return;

    // Fresh listeners each call so we never stack duplicates.
    try { await Push.removeAllListeners(); } catch { /* older plugin */ }

    Push.addListener("registration", async (t: { value: string }) => {
      const platform = cap.getPlatform?.() === "ios" ? "ios" : "android";
      await apiPost("/api/push/register", { token: t.value, platform }, accessToken).catch(() => {});
    });
    Push.addListener("registrationError", () => { /* ignore — retried next open */ });

    // Tapping a notification opens the screen it points at.
    Push.addListener("pushNotificationActionPerformed", (a: any) => {
      const url = a?.notification?.data?.url;
      if (url && typeof url === "string") { try { window.location.href = url; } catch { /* ignore */ } }
    });

    await Push.register();
  } catch {
    /* plugin unavailable or running on web — ignore */
  }
}
