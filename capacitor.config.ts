import type { CapacitorConfig } from "@capacitor/cli";

// PRFET native shell (Capacitor). Because PRFET is a server-rendered Next.js app
// (API routes + DB), the native app loads your HOSTED server URL rather than a
// static bundle.
const config: CapacitorConfig = {
  // The REAL package id, and it can never change: the Play listing (PRFET) was created
  // when the project was still called Herot, and android/app/build.gradle builds this.
  // This line used to say "com.prfet.app", which was never what shipped — it only matters
  // when the native project is generated, but a `cap sync` or a regenerated android/
  // folder reading it would have produced a bundle Google rejects.
  appId: "com.herot.app",
  // NOTE: the Play listing name shown to users is "PRFET" — set in the Play Console,
  // not here.
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
