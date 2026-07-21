import CountryScreen from "@/components/country-screen";

export default function CountryPage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-white">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-white">
        <CountryScreen />
      </div>
    </main>
  );
}
