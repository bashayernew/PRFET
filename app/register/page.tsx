import RegisterScreen from "@/components/register-screen";

export default function RegisterPage() {
  return (
    <main className="flex min-h-[100dvh] w-full justify-center bg-white">
      <div className="relative w-full max-w-[440px] min-h-[100dvh] overflow-hidden bg-white">
        <RegisterScreen />
      </div>
    </main>
  );
}
