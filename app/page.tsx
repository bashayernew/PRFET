import WelcomeScreen from "@/components/welcome-screen";

export default function Home() {
  return (
    <main className="min-h-[100dvh] w-full bg-brand-900 flex justify-center">
      {/* Phone-width shell so it looks like an app even on a desktop browser */}
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-brand-900">
        <WelcomeScreen />
      </div>
    </main>
  );
}
