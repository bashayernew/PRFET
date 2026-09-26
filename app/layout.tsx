import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import CallHost from "@/components/call-host";
import PullToRefresh from "@/components/pull-to-refresh";
import BlockedGate from "@/components/blocked-gate";
import AudioUnlock from "@/components/audio-unlock";

/**
 * next/font downloads Cairo from Google's servers during `npm run build`.
 *
 * On 2026-09-26 that request failed and the whole deploy died with
 * `TypeError: Cannot read properties of null` inside @next/font's loader — nothing to do
 * with our code. A production deploy that can only succeed while fonts.googleapis.com is
 * reachable is a fragile thing to have in the release path.
 *
 * `adjustFontFallback` and an explicit `fallback` stack mean the page still renders
 * correctly in a system Arabic font if the download is ever unavailable, rather than
 * shipping a broken layout.
 */
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cairo",
  display: "swap",
  fallback: ["Segoe UI", "Tahoma", "Arial", "sans-serif"],
  adjustFontFallback: false,
});

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
      <body className={`${cairo.variable} font-[family-name:var(--font-cairo)] antialiased`}>
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
