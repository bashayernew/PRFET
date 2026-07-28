"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, ArrowLeft, ArrowRight, User, Store } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getAccessToken } from "@/lib/api";

type Account = "personal" | "business";

const up = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.06 + i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] } }),
};

export default function WelcomeScreen() {
  const router = useRouter();
  const { t, dir, locale, setLocale } = useI18n();
  const [account, setAccount] = useState<Account | null>(null);
  const Forward = dir === "rtl" ? ArrowLeft : ArrowRight;

  // Already signed in? Straight to home — no welcome screen on every visit.
  useEffect(() => {
    if (getAccessToken()) router.replace("/home");
  }, [router]);

  return (
    <div dir={dir} className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-[calc(env(safe-area-inset-top)+30px)]">
      {/* brand */}
      <motion.div variants={up} custom={0} initial="hidden" animate="show" className="flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/prfet-logo.png" alt="PRFET" className="h-auto w-[260px] max-w-[75%] object-contain" />
        <p className="mt-6 text-[15px] font-bold text-ink">{t("welcome.tagline")}</p>
      </motion.div>

      {/* language */}
      <motion.p variants={up} custom={1} initial="hidden" animate="show" className="mt-8 text-[13px] font-bold text-ink">
        {t("welcome.chooseLang")}
      </motion.p>
      <motion.div variants={up} custom={2} initial="hidden" animate="show" className="mt-3 grid grid-cols-2 gap-3">
        <LangCard label="العربية" flag="🇰🇺" active={locale === "ar"} onClick={() => setLocale("ar")} />
        <LangCard label="English" flag="🇬🇧" active={locale === "en"} onClick={() => setLocale("en")} />
      </motion.div>

      {/* account type */}
      <motion.p variants={up} custom={3} initial="hidden" animate="show" className="mt-7 text-[13px] font-bold text-ink">
        {t("account.title")}
      </motion.p>
      <motion.div variants={up} custom={4} initial="hidden" animate="show" className="mt-3 flex flex-col gap-3">
        <TypeCard active={account === "personal"} onClick={() => setAccount("personal")} icon={<User className="h-6 w-6" strokeWidth={2.2} />} title={t("account.personal.title")} sub={t("account.personal.sub")} />
        <TypeCard active={account === "business"} onClick={() => setAccount("business")} icon={<Store className="h-6 w-6" strokeWidth={2.2} />} title={t("account.business.title")} sub={t("account.business.sub")} />
      </motion.div>

      {/* continue */}
      <motion.button
        variants={up}
        custom={5}
        initial="hidden"
        animate="show"
        whileTap={account ? { scale: 0.97 } : undefined}
        disabled={!account}
        onClick={() => {
          if (!account) return;
          localStorage.setItem("herot.accountType", account);
          router.push("/register");
        }}
        className={`group mt-8 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all ${
          account ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]" : "cursor-not-allowed bg-slate-100 text-slate-400"
        }`}
      >
        {t("welcome.getStarted")}
        <Forward className="h-5 w-5" strokeWidth={2.4} />
      </motion.button>

      <p className="mt-4 text-center text-[13px] text-muted">
        {t("welcome.haveAccount")}{" "}
        <button onClick={() => router.push("/login")} className="font-bold text-brand-600">
          {t("welcome.login")}
        </button>
      </p>
    </div>
  );
}

function LangCard({ label, flag, active, onClick }: { label: string; flag: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`relative overflow-hidden rounded-2xl border-2 py-4 text-center transition-all ${active ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <span className="text-2xl">{flag}</span>
      <span className={`mt-1.5 block text-[15px] font-bold ${active ? "text-brand-700" : "text-slate-600"}`}>{label}</span>
      {active && (
        <span className="absolute left-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-brand-500">
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function TypeCard({ active, onClick, icon, title, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <button onClick={onClick} className={`relative flex items-center gap-3.5 rounded-2xl border-2 p-4 text-start transition-all ${active ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-colors ${active ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-600"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-extrabold text-ink">{title}</p>
        <p className="text-[12.5px] font-medium text-muted">{sub}</p>
      </div>
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-all ${active ? "border-brand-500 bg-brand-500" : "border-slate-300 bg-white"}`}>
        {active && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
      </span>
    </button>
  );
}
