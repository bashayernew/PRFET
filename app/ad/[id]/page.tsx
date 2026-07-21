import AdScreen from "@/components/ad-screen";

export default async function AdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-slate-50">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-slate-50">
        <AdScreen id={id} />
      </div>
    </main>
  );
}
