import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Skip type-checking and linting during `next build` — they're memory-heavy and are
  // handled in dev/CI instead. This keeps production builds fast and reliable on small boxes.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // 'export' makes a static build that Capacitor wraps into iOS/Android apps.
  // Keep commented for normal `npm run dev`; uncomment when building native apps.
  // output: "export",
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        /**
         * Never let a device cache an HTML document. (2026-09-26)
         *
         * Statically prerendered pages were being served with
         * `cache-control: s-maxage=31536000` — a YEAR. The Android WebView pinned the old
         * document, which references chunk filenames by content hash, so the app kept
         * loading pre-deploy JavaScript no matter how many times the server was rebuilt.
         * Clearing the app cache, reinstalling, even a new AAB did not shift it.
         *
         * That is fatal for this app specifically: the native shell is a WebView pointed at
         * a live server, so the HTML is not a build artifact, it is the delivery mechanism
         * for every web deploy. It has to revalidate every time.
         *
         * Hashed assets under /_next/static are excluded and stay immutable — those are
         * safe to cache forever precisely because their names change when they do. Uploads
         * are excluded too; they never change once written.
         */
        source: "/((?!_next/static|_next/image|uploads/).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
