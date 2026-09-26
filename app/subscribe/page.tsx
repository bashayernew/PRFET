import SubscribeScreen from "@/components/subscribe-screen";

/**
 * Rendered per request, not prerendered at build time.
 *
 * As a static page this was served with `cache-control: s-maxage=31536000` and the Android
 * WebView held the old HTML for a year — which pins the hashed chunk filenames, so the app
 * kept running pre-deploy JavaScript that no rebuild, cache clear or reinstall could shift.
 * The paywall appeared broken for hours because of this, not because of anything in the
 * payment code.
 *
 * The page renders a client component and has nothing to prerender, so there is no cost.
 */
export const dynamic = "force-dynamic";

export default function SubscribePage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-slate-50">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-slate-50">
        <SubscribeScreen />
      </div>
    </main>
  );
}
