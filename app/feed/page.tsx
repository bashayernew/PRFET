import FeedScreen from "@/components/feed-screen";

export default function FeedPage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-black">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-black">
        <FeedScreen />
      </div>
    </main>
  );
}
