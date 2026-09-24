"use client";

/**
 * What a blocked member sees instead of the app.
 *
 * The admin sets a duration and a reason; this is where the person actually learns both.
 * That's the whole point of letting a blocked account still sign in — refusing them at the
 * login screen would leave them staring at a generic error with no idea why or for how long.
 *
 * Rendered by CallHost's sibling in the root layout, so it covers every route without each
 * screen needing to know about it.
 */

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { apiGet, getAccessToken, clearTokens } from "@/lib/api";
import { useRouter } from "next/navigation";

type Moderation = {
  suspended: boolean;
  suspendReason: string | null;
  suspendedUntil: string | null;
  daysLeft: number;
};

export default function BlockedGate() {
  const { t, locale, dir } = useI18n();
  const router = useRouter();
  const [mod, setMod] = useState<Moderation | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const token = getAccessToken();
      if (!token) { if (alive) setMod(null); return; }
      const res = await apiGet<{ moderation?: Moderation }>("/api/auth/me", token);
      if (!alive) return;
      // A disabled account is refused by /me outright — nothing to show, just sign out.
      if (!res.ok) { setMod(null); return; }
      setMod(res.data?.moderation?.suspended ? res.data.moderation : null);
    };
    check();
    // Re-check on return to the app so a lifted block clears without a manual reload.
    const onFocus = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; document.removeEventListener("visibilitychange", onFocus); };
  }, []);

  if (!mod?.suspended) return null;

  const until = mod.suspendedUntil ? new Date(mod.suspendedUntil) : null;

  function signOut() {
    clearTokens();
    router.replace("/login");
  }

  return (
    <div
      data-no-pull-refresh
      dir={dir}
      className="fixed inset-0 z-[95] mx-auto flex max-w-[480px] flex-col items-center justify-center gap-5 bg-gradient-to-b from-brand-800 to-brand-900 px-8 text-center text-white"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
        <ShieldAlert className="h-8 w-8 text-red-400" />
      </div>

      <h1 className="text-[20px] font-extrabold">{t("blocked.title")}</h1>

      {/* The countdown, which is the thing people actually want to know. */}
      <div className="w-full rounded-3xl bg-white/10 p-5">
        <p className="text-[38px] font-extrabold leading-none">{ld(mod.daysLeft, locale)}</p>
        <p className="mt-1 text-[13px] font-bold text-white/80">
          {mod.daysLeft === 1 ? t("blocked.dayLeft") : t("blocked.daysLeft")}
        </p>
        {until && (
          <p className="mt-3 text-[12px] font-semibold text-white/60">
            {t("blocked.until").replace(
              "{d}",
              until.toLocaleDateString(locale === "ar" ? "ar" : "en-GB", {
                day: "numeric", month: "long", year: "numeric",
              }),
            )}
          </p>
        )}
      </div>

      {mod.suspendReason && (
        <div className="w-full rounded-3xl bg-white/10 p-4 text-start">
          <p className="mb-1 text-[12px] font-bold text-white/60">{t("blocked.reason")}</p>
          <p className="text-[14px] font-bold">{mod.suspendReason}</p>
        </div>
      )}

      <p className="text-[12.5px] font-semibold text-white/60">{t("blocked.appeal")}</p>

      <button
        onClick={signOut}
        className="mt-2 rounded-2xl bg-white/15 px-6 py-3 text-[13.5px] font-extrabold text-white"
      >
        {t("blocked.signOut")}
      </button>
    </div>
  );
}
