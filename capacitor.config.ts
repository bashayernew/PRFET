import type { CapacitorConfig } from "@capacitor/cli";

// Herot native shell (Capacitor). Because Herot is a server-rendered Next.js app
// (API routes + DB), the native app loads your HOSTED server URL rather than a
// static bundle. Swap `server.url` for your real deployed URL.
const config: CapacitorConfig = {
  appId: "com.herot.app",       // reverse-domain id; must match store listing
  appName: "PRFET",
  webDir: "public",              // placeholder (unused when server.url is set)
  server: {
    url: "https://prfet.com", // <-- your hosted server
    cleartext: false,             // https only
  },
  ios: { contentInset: "always" },
  android: { allowMixedContent: false },
};

export default config;
