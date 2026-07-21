import MeetingRoomScreen from "@/components/meeting-room-screen";

export default async function MeetingRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-slate-900">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-slate-900">
        <MeetingRoomScreen id={id} />
      </div>
    </main>
  );
}
