import FollowingScreen from "@/components/following-screen";

export default function FollowingPage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-slate-50">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-slate-50">
        <FollowingScreen />
      </div>
    </main>
  );
}
