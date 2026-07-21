"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Crown, Check, Palette, MapPin, Link2, CreditCard, Lock, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiPost, getAccessToken } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

export default function SubscribeScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [holder, setHolder] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // bundle prices from the dashboard + which bundle is picked
  const [months, setMonths] = useState<1 | 3 | 6 | 12>(1);
  const [tiers, setTiers] = useState<Record<number, number>>({ 1: 4.99, 3: 13.99, 6: 26.99, 12: 53.99 });

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => {
        const s = d?.settings ?? {};
        setTiers((prev) => ({
          1: typeof s.priceSubscription === "number" ? s.priceSubscription : prev[1],
          3: typeof s.priceSub3m === "number" ? s.priceSub3m : prev[3],
          6: typeof s.priceSub6m === "number" ? s.priceSub6m : prev[6],
          12: typeof s.priceSub12m === "number" ? s.priceSub12m : prev[12],
        }));
      })
      .catch(() => {});
  }, []);

  const price = tiers[months];

  if (!ready) return null;

  const valid = card.replace(/\s/g, "").length >= 12 && exp.length >= 4 && cvc.length >= 3 && holder.trim().length >= 2;

  async function pay() {
    if (!valid || submitting) return;
    setSubmitting(true);
    const token = getAccessToken() || undefined;
    const res = await apiPost("/api/subscribe", { months }, token);
    if (res.ok) {
      setDone(true);
      setTimeout(() => router.push("/profile"), 1700);
    } else {
      setSubmitting(false);
    }
  }

  const shell = "mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-slate-50";

  if (done) {
    return (
      <div dir={dir} className={`${shell} items-center justify-center bg-white px-6 text-center`}>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid h-20 w-20 place-items-center rounded-3xl bg-emerald-50">
          <CheckCircle2 className="h-11 w-11 text-emerald-500" strokeWidth={2} />
        </motion.div>
        <h1 className="mt-6 text-2xl font-extrabold text-ink">{t("premium.success")}</h1>
        <p className="mt-2 max-w-[300px] text-[14px] leading-relaxed text-muted">{t("premium.successHint")}</p>
      </div>
    );
  }

  return (
    <div dir={dir} className={shell}>
      {/* header */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-8 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/profile")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="text-[18px] font-extrabold text-white">{t("premium.title")}</h1>
        </div>
      </div>

      <div className="no-scrollbar -mt-4 flex-1 overflow-y-auto px-5 pb-5">
        {/* plan card */}
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-500">
              <Crown className="h-7 w-7" />
            </span>
            <div className="flex-1">
              <p className="text-[16px] font-extrabold text-ink">{t("premium.title")}</p>
              <p className="text-[12.5px] font-medium text-muted">{t("premium.tagline")}</p>
            </div>
            <div className="text-end">
              <p dir="ltr" className="text-[22px] font-extrabold text-brand-700">${price}</p>
              <p className="text-[10.5px] font-bold text-muted">{t(`premium.m${months}`)}</p>
            </div>
          </div>

          {/* bundle picker — 1 / 3 / 6 / 12 months, dashboard-priced */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {([1, 3, 6, 12] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`flex flex-col items-center rounded-2xl border-2 px-1 py-2.5 ${
                  months === m ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className={`text-[12px] font-extrabold ${months === m ? "text-brand-700" : "text-ink"}`}>{t(`premium.m${m}`)}</span>
                <span dir="ltr" className={`mt-0.5 text-[12.5px] font-extrabold ${months === m ? "text-brand-700" : "text-muted"}`}>${tiers[m]}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2.5 border-t border-slate-100 pt-4">
            <Perk icon={<Palette className="h-4 w-4" />} label={t("premium.perk1")} />
            <Perk icon={<MapPin className="h-4 w-4" />} label={t("premium.perk2")} />
            <Perk icon={<Link2 className="h-4 w-4" />} label={t("premium.perk3")} />
          </div>
        </div>

        {/* card form */}
        <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="mb-3 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-brand-600" />
            <p className="text-[14px] font-extrabold text-ink">{t("premium.card")}</p>
          </div>
          <Field label={t("premium.cardNum")} value={card} onChange={(v) => setCard(v.replace(/[^\d ]/g, "").slice(0, 19))} placeholder="4242 4242 4242 4242" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label={t("premium.exp")} value={exp} onChange={(v) => setExp(v.replace(/[^\d/]/g, "").slice(0, 5))} placeholder="MM/YY" />
            <Field label={t("premium.cvc")} value={cvc} onChange={(v) => setCvc(v.replace(/\D/g, "").slice(0, 4))} placeholder="123" />
          </div>
          <div className="mt-3">
            <Field label={t("premium.cardName")} value={holder} onChange={setHolder} placeholder="—" />
          </div>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-muted">
            <Lock className="h-3.5 w-3.5" /> {t("premium.demo")}
          </p>
        </div>

        {/* pay */}
        <button
          onClick={pay}
          disabled={!valid || submitting}
          className={`mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-bold transition-all ${
            valid && !submitting ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]" : "cursor-not-allowed bg-slate-200 text-slate-400"
          }`}
        >
          {submitting ? t("common.loading") : t("premium.pay")}
        </button>
      </div>
    </div>
  );
}

function Perk({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <span className="flex-1 text-[13px] font-bold text-ink">{label}</span>
      <Check className="h-4 w-4 text-emerald-500" strokeWidth={3} />
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-bold text-ink">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir="ltr"
        className="h-12 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 text-[15px] font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted focus:border-brand-500 focus:bg-white"
      />
    </div>
  );
}
