"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, AtSign, Lock, Eye, EyeOff, KeyRound, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiPost } from "@/lib/api";

const LEN = 4;
const idOk = (v: string) => {
  const s = v.trim();
  if (s.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  return /^\+?[0-9]{7,15}$/.test(s.replace(/[\s()-]/g, ""));
};
const normId = (v: string) => (v.includes("@") ? v.trim().toLowerCase() : v.replace(/[\s()-]/g, ""));

export default function ForgotScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [identifier, setIdentifier] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const code = digits.join("");

  async function sendCode() {
    if (!idOk(identifier) || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await apiPost<{ devCode?: string }>("/api/auth/forgot", { identifier: normId(identifier) });
    if (res.ok) {
      if (res.data?.devCode) setDevCode(res.data.devCode);
      setStep("reset");
      setSeconds(30);
    } else {
      setError(t("common.error"));
    }
    setSubmitting(false);
  }

  async function reset() {
    if (code.length !== LEN || password.length < 8 || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await apiPost<{ error?: string }>("/api/auth/reset", { identifier: normId(identifier), code, password });
    if (res.ok) {
      setStep("done");
    } else {
      setError(res.data?.error === "code_expired" ? t("verify.expired") : t("verify.invalid"));
      setDigits(Array(LEN).fill(""));
      inputs.current[0]?.focus();
    }
    setSubmitting(false);
  }

  function setAt(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (!clean) {
      setDigits((d) => d.map((x, idx) => (idx === i ? "" : x)));
      return;
    }
    if (clean.length > 1) {
      const arr = clean.slice(0, LEN).split("");
      const next = Array(LEN).fill("");
      arr.forEach((ch, idx) => (next[idx] = ch));
      setDigits(next);
      inputs.current[Math.min(arr.length, LEN - 1)]?.focus();
      return;
    }
    setDigits((d) => d.map((x, idx) => (idx === i ? clean : x)));
    if (i < LEN - 1) inputs.current[i + 1]?.focus();
  }

  const shell = "mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-[calc(env(safe-area-inset-top)+18px)]";

  if (step === "done") {
    return (
      <div dir={dir} className={`${shell} items-center justify-center text-center`}>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid h-20 w-20 place-items-center rounded-3xl bg-emerald-50">
          <CheckCircle2 className="h-11 w-11 text-emerald-500" strokeWidth={2} />
        </motion.div>
        <h1 className="mt-6 text-2xl font-extrabold text-ink">{t("forgot.success")}</h1>
        <p className="mt-2 max-w-[300px] text-[14px] leading-relaxed text-muted">{t("forgot.successHint")}</p>
        <button onClick={() => router.push("/login")} className="mt-8 w-full max-w-[320px] rounded-2xl bg-gradient-to-l from-brand-700 to-brand-500 py-4 text-base font-bold text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]">
          {t("forgot.backToLogin")}
        </button>
      </div>
    );
  }

  return (
    <div dir={dir} className={shell}>
      <button onClick={() => (step === "reset" ? setStep("request") : router.push("/login"))} aria-label={t("back")} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-ink active:scale-95">
        <Back className="h-5 w-5" strokeWidth={2.4} />
      </button>

      <div className="mt-8 grid h-16 w-16 place-items-center self-center rounded-3xl bg-brand-50">
        <KeyRound className="h-8 w-8 text-brand-600" strokeWidth={2} />
      </div>

      {step === "request" ? (
        <>
          <h1 className="mt-6 text-center text-2xl font-extrabold text-ink">{t("forgot.title")}</h1>
          <p className="mx-auto mt-2 max-w-[320px] text-center text-[14px] leading-relaxed text-muted">{t("forgot.subtitle")}</p>

          <div className="mt-8">
            <label className="mb-1.5 block text-[13px] font-bold text-ink">{t("login.identifier")}</label>
            <div className="flex items-center gap-2.5 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 transition-colors focus-within:border-brand-500 focus-within:bg-white">
              <AtSign className="h-5 w-5 text-muted" />
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
                type="text"
                dir="ltr"
                placeholder={t("login.identifierPh")}
                className="h-12 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted"
              />
            </div>
          </div>

          {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-center text-[13px] font-medium text-red-600">{error}</p>}

          <button
            onClick={sendCode}
            disabled={!idOk(identifier) || submitting}
            className={`mt-auto flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all ${
              idOk(identifier) && !submitting ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]" : "cursor-not-allowed bg-slate-100 text-slate-400"
            }`}
          >
            {submitting ? t("common.loading") : t("forgot.send")}
          </button>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-center text-2xl font-extrabold text-ink">{t("forgot.codeTitle")}</h1>
          <p className="mx-auto mt-2 text-center text-[14px] leading-relaxed text-muted">{t("forgot.codeSubtitle")}</p>
          <p dir="ltr" className="mt-1 text-center text-[14px] font-bold text-brand-600">{normId(identifier)}</p>

          {devCode && (
            <p className="mx-auto mt-3 rounded-xl bg-amber-50 px-3 py-1.5 text-center text-[12.5px] font-bold text-amber-700">
              {t("verify.devHint")}: <span dir="ltr">{devCode}</span>
            </p>
          )}

          <div dir="ltr" className="mt-6 flex justify-center gap-2.5">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputs.current[i] = el; }}
                value={d}
                onChange={(e) => setAt(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus(); }}
                inputMode="numeric"
                maxLength={1}
                className={`h-14 w-12 rounded-2xl border-2 text-center text-2xl font-extrabold text-ink outline-none transition-all ${d ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-slate-50 focus:border-brand-500 focus:bg-white"}`}
              />
            ))}
          </div>

          <div className="mt-5">
            <label className="mb-1.5 block text-[13px] font-bold text-ink">{t("forgot.newPassword")}</label>
            <div className="flex items-center gap-2.5 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 transition-colors focus-within:border-brand-500 focus-within:bg-white">
              <Lock className="h-5 w-5 text-muted" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={show ? "text" : "password"}
                dir="ltr"
                placeholder={t("register.passwordPh")}
                onKeyDown={(e) => e.key === "Enter" && reset()}
                className="h-12 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted"
              />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label="toggle password" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-slate-100">
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p className="mt-1 text-[12px] text-muted">{t("register.passwordHint")}</p>
          </div>

          <div className="mt-4 text-center text-[13px] text-muted">
            {t("verify.didntGet")}{" "}
            {seconds > 0 ? (
              <span className="font-bold text-ink/70">{t("verify.resendIn")} {seconds}{t("verify.seconds")}</span>
            ) : (
              <button onClick={sendCode} className="font-bold text-brand-600">{t("verify.resend")}</button>
            )}
          </div>

          {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-center text-[13px] font-medium text-red-600">{error}</p>}

          <button
            onClick={reset}
            disabled={code.length !== LEN || password.length < 8 || submitting}
            className={`mt-auto flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all ${
              code.length === LEN && password.length >= 8 && !submitting ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]" : "cursor-not-allowed bg-slate-100 text-slate-400"
            }`}
          >
            {submitting ? t("common.loading") : t("forgot.reset")}
          </button>
        </>
      )}
    </div>
  );
}
