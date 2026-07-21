import HomeScreen from "@/components/home-screen";

export default function HomePage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-slate-50">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-slate-50">
        <HomeScreen />
      </div>
    </main>
  );
}
