// Toggle native screenshot protection (Android FLAG_SECURE via @capacitor-community/privacy-screen).
// No-op on the web; only active inside the Capacitor native app.
let active = false;

export async function setSecureScreen(on: boolean): Promise<void> {
  if (typeof window === "undefined") return;
  if (on === active) return;
  try {
    const capName = "@capacitor/core";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap: any = await import(/* @vite-ignore */ capName);
    if (!cap?.Capacitor?.isNativePlatform || !cap.Capacitor.isNativePlatform()) return;
    const psName = "@capacitor-community/privacy-screen";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ps: any = await import(/* @vite-ignore */ psName);
    const PrivacyScreen = ps.PrivacyScreen || ps.default;
    if (on) await PrivacyScreen.enable();
    else await PrivacyScreen.disable();
    active = on;
  } catch {
    /* plugin not present (e.g. web build) — ignore */
  }
}
