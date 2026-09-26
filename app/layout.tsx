import type { Metadata, Viewport } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import CallHost from "@/components/call-host";
import PullToRefresh from "@/components/pull-to-refresh";
import BlockedGate from "@/components/blocked-gate";
import AudioUnlock from "@/components/audio-unlock";

/**
 * Cairo is loaded at RUNTIME via a stylesheet link, not through next/font.
 *
 * next/font downloads the font from Google during `npm run build`. On 2026-09-26 that
 * request kept failing from the production server and killed every deploy with
 * `TypeError: Cannot read properties of null` inside @next/font's loader — nothing to do
 * with our code, and nothing we could fix from here.
 *
 * A release pipeline must not depend on a third party being reachable at build time. The
 * link below is fetched by the browser instead, and `--font-cairo` (defined in
 * globals.css) falls back to a system Arabic stack if Google is unreachable, so the worst
 * case is a slightly different typeface rather than a failed deploy or a broken page.
 */
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap";
export const metadata: Metadata = {
  title: "PRFET",
  description: "اكتشف وتواصل مع ما حولك — Discover and connect with what's around you.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PRFET" },
};

export const viewport: Viewport = {
  themeColor: "#0b0718",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
      </head>
      <body className="font-[family-name:var(--font-cairo)] antialiased">
        <I18nProvider>
          {children}
          {/* the first tap anywhere unlocks audio, so live rooms are never silent */}
          <AudioUnlock />
          {/* pull down anywhere to refresh — wired screens refetch, the rest reload */}
          <PullToRefresh />
          {/* rings anywhere in the app, not just inside a chat */}
          <CallHost />
          {/* a blocked member sees the reason and the countdown instead of the app */}
          <BlockedGate />
        </I18nProvider>
      </body>
    </html>
  );
}
