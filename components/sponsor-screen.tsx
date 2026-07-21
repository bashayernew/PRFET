"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Crown, Link2, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Sponsor = { sponsorName?: string; sponsorLogo?: string; sponsorText?: string; sponsorUrl?: string; sponsorUserId?: string };

/**
 * The sponsorship page — deliberately WHITE and quiet, showing exactly what the
 * admin loaded from the dashboard. No sponsor set = the page is closed outright.
 */
export default function SponsorScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [s, setS] = useState<Sponsor | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => { setS(d?.settings ?? {}); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const hasSponsor = !!(s?.sponsorName || s?.sponsorLogo || s?.sponsorText || s?.sponsorUserId);

  return (
    <div dir={dir} className="flex min-h-[100dvh] flex-col bg-white px-6 pb-8 pt-[calc(env(safe-area-inset-top)+16px)]">
      <button onClick={() => router.push("/home")} aria-label={t("back")}
        className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-ink active:scale-95">
        <Back className="h-5 w-5" strokeWidth={2.4} />
      </button>

      {!loaded ? null : !hasSponsor ? (
        /* closed completely until the admin loads a sponsor */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-3xl bg-slate-100 text-slate-400"><Lock className="h-7 w-7" /></span>
          <p className="text-[16px] font-extrabold text-ink">{t("sponsor.closed")}</p>
          <p className="max-w-[260px] text-[13px] font-medium text-muted">{t("sponsor.closedHint")}</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wider text-muted">
            <Crown className="h-4 w-4 text-amber-500" /> {t("sponsor.title")}
          </p>
          {s?.sponsorLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.sponsorLogo} alt={s?.sponsorName || ""} className="max-h-40 w-auto max-w-[260px] object-contain" />
          )}
          {s?.sponsorName && <h1 className="text-[22px] font-extrabold text-ink">{s.sponsorName}</h1>}
          {s?.sponsorText && <p className="max-w-[320px] whitespace-pre-line text-[14px] font-medium leading-relaxed text-muted">{s.sponsorText}</p>}
          {s?.sponsorUrl && (
            <a href={s.sponsorUrl} target="_blank" rel="noopener noreferrer"
              className="flex h-11 items-center gap-2 rounded-2xl bg-ink px-6 text-[13.5px] font-bold text-white active:scale-95">
              <Link2 className="h-4 w-4" /> {t("sponsor.visit")}
            </a>
          )}
          {/* the sponsor's real account inside the app */}
          {s?.sponsorUserId && (
            <button onClick={() => router.push(`/business/${s.sponsorUserId}`)}
              className="flex h-11 items-center gap-2 rounded-2xl bg-amber-500 px-6 text-[13.5px] font-extrabold text-white active:scale-95">
              <Crown className="h-4 w-4" /> {t("sponsor.visitAccount")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
