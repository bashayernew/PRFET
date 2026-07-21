import AdminScreen from "@/components/admin-screen";

// The dashboard is the one screen that ISN'T phone-shaped — it uses the whole desktop.
export default function AdminPage() {
  return (
    <main className="min-h-[100dvh] w-full bg-slate-100">
      <AdminScreen />
    </main>
  );
}
