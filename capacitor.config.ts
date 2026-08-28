import type { CapacitorConfig } from "@capacitor/cli";

// PRFET native shell (Capacitor). Because PRFET is a server-rendered Next.js app
// (API routes + DB), the native app loads your HOSTED server URL rather than a
// static bundle.
const config: CapacitorConfig = {
  appId: "com.prfet.app",        // permanent Apple/Google package id — can never be changed after first store submission
  appName: "PRFET",              // the name users see
  webDir: "public",              // placeholder (unused when server.url is set)
  server: {
    url: "https://prfet.com",    // your hosted server
    cleartext: false,            // https only
  },
  ios: { contentInset: "always" },
  android: { allowMixedContent: false },
};

export default config;
