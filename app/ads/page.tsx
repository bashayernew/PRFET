import AdsScreen from "@/components/ads-screen";

export default function AdsPage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-slate-50">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-slate-50">
        <AdsScreen />
      </div>
    </main>
  );
}
