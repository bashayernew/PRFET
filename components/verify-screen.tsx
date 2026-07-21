"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, MailCheck } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { apiPost, saveTokens } from "@/lib/api";

const LEN = 4;

export default function VerifyScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const Forward = dir === "rtl" ? ArrowLeft : ArrowRight;

  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [identifier, setIdentifier] = useState("you@example.com");
  const [seconds, setSeconds] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const e = localStorage.getItem("herot.pendingId");
    if (e) setIdentifier(e);
    const dc = localStorage.getItem("herot.devCode");
    if (dc) setDevCode(dc);
  }, []);

  async function handleVerify() {
    if (!complete || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await apiPost<{ accessToken: string; refreshToken: string; error?: string }>(
      "/api/auth/verify-otp",
      { identifier, code }
    );
    if (res.ok) {
      saveTokens(res.data);
      localStorage.removeItem("herot.devCode");
      sessionStorage.removeItem("herot.regDraft"); // account done — drop the register draft
      router.push("/home");
      return;
    }
    setError(res.data?.error === "code_expired" ? t("verify.expired") : t("verify.invalid"));
    setDigits(Array(LEN).fill(""));
    inputs.current[0]?.focus();
    setSubmitting(false);
  }

  async function doResend() {
    if (seconds > 0) return;
    const res = await apiPost<{ devCode?: string }>("/api/auth/resend-otp", { identifier });
    if (res.data?.devCode) {
      setDevCode(res.data.devCode);
      localStorage.setItem("herot.devCode", res.data.devCode);
    }
    setDigits(Array(LEN).fill(""));
    setSeconds(30);
    setError(null);
    inputs.current[0]?.focus();
  }

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const code = digits.join("");
  const complete = code.length === LEN;

  function setAt(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (!clean) {
      setDigits((d) => d.map((x, idx) => (idx === i ? "" : x)));
      return;
    }
    // handle paste of multiple chars
    if (clean.length > 1) {
      const arr = clean.slice(0, LEN).split("");
      const next = Array(LEN).fill("");
      arr.forEach((c, idx) => (next[idx] = c));
      setDigits(next);
      inputs.current[Math.min(arr.length, LEN - 1)]?.focus();
      return;
    }
    setDigits((d) => d.map((x, idx) => (idx === i ? clean : x)));
    if (i < LEN - 1) inputs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  return (
    <div dir={dir} className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-[calc(env(safe-area-inset-top)+18px)]">
      {/* top bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/register")}
          aria-label={t("back")}
          className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-ink active:scale-95"
        >
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <div className="flex flex-1 items-center gap-1.5">
          <span className="h-1.5 flex-1 rounded-full bg-brand-500" />
          <span className="h-1.5 flex-1 rounded-full bg-brand-500" />
          <span className="h-1.5 flex-1 rounded-full bg-brand-500" />
        </div>
        <span className="text-[12px] font-bold text-muted">{ld(3, locale)} / {ld(3, locale)}</span>
      </div>

      {/* icon */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="mt-10 grid h-20 w-20 place-items-center self-center rounded-3xl bg-brand-50"
      >
        <MailCheck className="h-10 w-10 text-brand-600" strokeWidth={2} />
      </motion.div>

      {/* heading */}
      <h1 className="mt-6 text-center text-2xl font-extrabold text-ink">{t("verify.title")}</h1>
      <p className="mx-auto mt-2 max-w-[320px] text-center text-[14px] leading-relaxed text-muted">
        {t("verify.subtitle")}
      </p>
      <p dir="ltr" className="mt-1 text-center text-[14px] font-bold text-brand-600">{identifier}</p>
      <button
        onClick={() => router.push("/register")}
        className="mx-auto mt-1 text-[12.5px] font-bold text-muted underline-offset-2 hover:underline"
      >
        {t("verify.changeEmail")}
      </button>

      {/* dev code hint (development only) */}
      {devCode && (
        <p className="mx-auto mt-3 rounded-xl bg-amber-50 px-3 py-1.5 text-center text-[12.5px] font-bold text-amber-700">
          {t("verify.devHint")}: <span dir="ltr">{devCode}</span>
        </p>
      )}

      {/* OTP boxes */}
      <div dir="ltr" className="mt-8 flex justify-center gap-2.5">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            value={d}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            inputMode="numeric"
            maxLength={1}
            className={`h-14 w-12 rounded-2xl border-2 text-center text-2xl font-extrabold text-ink outline-none transition-all ${
              d ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-slate-50 focus:border-brand-500 focus:bg-white"
            }`}
          />
        ))}
      </div>

      {/* resend */}
      <div className="mt-6 text-center text-[13px] text-muted">
        {t("verify.didntGet")}{" "}
        {seconds > 0 ? (
          <span className="font-bold text-ink/70">
            {t("verify.resendIn")} {ld(seconds, locale)}
            {locale === "ar" ? ` ${t("verify.seconds")}` : t("verify.seconds")}
          </span>
        ) : (
          <button onClick={doResend} className="font-bold text-brand-600">
            {t("verify.resend")}
          </button>
        )}
      </div>

      {/* error */}
      {error && (
        <p className="mx-auto mt-4 rounded-xl bg-red-50 px-3 py-2 text-center text-[13px] font-medium text-red-600">
          {error}
        </p>
      )}

      {/* verify */}
      <motion.button
        whileTap={complete && !submitting ? { scale: 0.97 } : undefined}
        disabled={!complete || submitting}
        onClick={handleVerify}
        className={`group mt-auto flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all ${
          complete && !submitting
            ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]"
            : "cursor-not-allowed bg-slate-100 text-slate-400"
        }`}
      >
        {submitting ? t("common.loading") : t("verify.verify")}
        {!submitting && <Forward className="h-5 w-5" strokeWidth={2.4} />}
      </motion.button>
    </div>
  );
}
