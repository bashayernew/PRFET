"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Megaphone, MessageCircle, User, Eye } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, getAccessToken } from "@/lib/api";
import { vipStyle } from "@/lib/vip";

type Advertiser = { id: string; displayName: string; avatarUrl: string | null; category: string | null; bio: string | null; isPremium?: boolean; textColor?: string | null };
type Ad = { id: string; caption: string | null; mediaUrl: string | null; views: number; advertiser: Advertiser };

/** The ad, full screen: the media large, the text, and the advertiser one tap away. */
export default function AdScreen({ id }: { id: string }) {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [ad, setAd] = useState<Ad | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!ready) return;
    apiGet<{ ad: Ad }>(`/api/ads/${id}`, getAccessToken() || undefined).then((res) => {
      if (res.ok && res.data?.ad) setAd(res.data.ad);
      else setGone(true);
    });
  }, [ready, id]);

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button onClick={() => router.back()} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-ink active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <p className="flex items-center gap-1.5 text-[16px] font-extrabold text-ink">
          <Megaphone className="h-4 w-4 text-brand-600" /> {t("ads.sponsored")}
        </p>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto">
        {gone && <p className="py-24 text-center text-[13.5px] font-bold text-muted">{t("ads.gone")}</p>}

        {ad && (
          <>
            {ad.mediaUrl ? (
              ad.mediaUrl.match(/\.(mp4|webm|mov)$/i) ? (
                <video src={ad.mediaUrl} controls playsInline className="max-h-[62dvh] w-full bg-black object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ad.mediaUrl} alt="" className="max-h-[62dvh] w-full bg-black object-contain" />
              )
            ) : (
              <div className="grid h-52 w-full place-items-center bg-gradient-to-br from-brand-700 to-brand-500 px-8">
                <p className="text-center text-[19px] font-extrabold leading-snug text-white">{ad.caption}</p>
              </div>
            )}

            <div className="px-5 py-4">
              {ad.mediaUrl && ad.caption && (
                <p className="mb-4 text-[15px] font-medium leading-relaxed text-ink">{ad.caption}</p>
              )}

              <button
                onClick={() => router.push(`/business/${ad.advertiser.id}`)}
                className="flex w-full items-center gap-3 rounded-3xl bg-white p-3.5 text-start ring-1 ring-slate-100 active:scale-[0.99]"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-50 text-[17px] font-extrabold text-brand-600">
                  {ad.advertiser.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ad.advertiser.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (ad.advertiser.displayName || "•").charAt(0).toUpperCase()
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-extrabold text-ink" style={vipStyle(ad.advertiser)}>
                    {ad.advertiser.displayName}
                  </span>
                  {ad.advertiser.bio && <span className="block truncate text-[12px] font-medium text-muted">{ad.advertiser.bio}</span>}
                </span>
                <User className="h-4 w-4 shrink-0 text-muted" />
              </button>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={() => router.push(`/messages/${ad.advertiser.id}`)}
                  className="flex items-center justify-center gap-1.5 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-bold text-white active:scale-[0.99]"
                >
                  <MessageCircle className="h-4 w-4" /> {t("home.message")}
                </button>
                <button
                  onClick={() => router.push(`/business/${ad.advertiser.id}`)}
                  className="flex items-center justify-center gap-1.5 rounded-2xl bg-white py-3.5 text-[14px] font-bold text-brand-700 ring-1 ring-slate-200 active:scale-[0.99]"
                >
                  <User className="h-4 w-4" /> {t("meet.viewProfile")}
                </button>
              </div>

              <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] font-bold text-muted">
                <Eye className="h-3.5 w-3.5" /> {ld(ad.views, locale)} {t("ads.views")}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
