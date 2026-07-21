import CreateScreen from "@/components/create-screen";

export default function CreatePage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-slate-50">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-slate-50">
        <CreateScreen />
      </div>
    </main>
  );
}
