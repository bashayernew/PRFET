import StoryScreen from "@/components/story-screen";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-brand-900">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden">
        <StoryScreen id={id} />
      </div>
    </main>
  );
}
