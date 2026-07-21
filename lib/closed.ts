import { prisma } from "@/lib/prisma";

/** Countries the admin has switched off — checked at register, login and on every /me. */
export async function getClosedCountries(): Promise<Set<string>> {
  const s = await prisma.appSettings.findUnique({
    where: { id: "app" },
    select: { closedCountries: true },
  });
  return new Set(
    (s?.closedCountries ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
  );
}

export async function isCountryClosed(code?: string | null): Promise<boolean> {
  if (!code) return false;
  const closed = await getClosedCountries();
  return closed.has(code.toUpperCase());
}
