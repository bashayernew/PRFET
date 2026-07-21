import SponsorScreen from "@/components/sponsor-screen";

export default function SponsorPage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-white">
      <div className="relative min-h-[100dvh] w-full max-w-[440px] overflow-hidden bg-white">
        <SponsorScreen />
      </div>
    </main>
  );
}
