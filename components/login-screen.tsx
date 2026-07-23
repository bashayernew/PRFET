"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, AtSign, Lock, Eye, EyeOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiPost, saveTokens } from "@/lib/api";

const identifierOk = (v: string) => {
  const s = v.trim();
  if (s.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  return /^\+?[0-9]{7,15}$/.test(s.replace(/[\s()-]/g, ""));
};

export default function LoginScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = identifierOk(identifier);

  function normId() {
    return identifier.includes("@") ? identifier.trim().toLowerCase() : identifier.replace(/[\s()-]/g, "");
  }

  async function codeLogin() {
    if (!identifierOk(identifier) || submitting) return;
    setSubmitting(true);
    setError(null);
    const id = normId();
    await apiPost("/api/auth/resend-otp", { identifier: id });
    localStorage.setItem("herot.pendingId", id);
    router.push("/verify");
  }

  async function handleSubmit() {
    if (!valid || submitting) return;
    if (!password) { codeLogin(); return; } // no password -> sign in with a code
    setSubmitting(true);
    setError(null);
    const id = normId();
    const res = await apiPost<{ accessToken: string; refreshToken: string; user?: { displayName: string }; error?: string }>(
      "/api/auth/login",
      { identifier: id, password }
    );
    if (res.ok) {
      saveTokens(res.data);
      if (res.data.user?.displayName) localStorage.setItem("herot.name", res.data.user.displayName);
      router.push("/home");
      return;
    }
    if (res.data?.error === "no_password") { codeLogin(); return; }
    setError(t(res.data?.error === "country_closed" ? "auth.countryClosed" : "login.invalid"));
    setSubmitting(false);
  }

  return (
    <div dir={dir} className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-[calc(env(safe-area-inset-top)+18px)]">
      <button
        onClick={() => router.push("/")}
        aria-label={t("back")}
        className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-ink active:scale-95"
      >
        <Back className="h-5 w-5" strokeWidth={2.4} />
      </button>

      {/* brand */}
      <div className="mt-8 flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.jpg" alt="PRFET" className="h-auto w-[150px] object-contain" />
        <h1 className="mt-5 text-2xl font-extrabold text-ink">{t("login.title")}</h1>
        <p className="mt-2 max-w-[300px] text-[14px] leading-relaxed text-muted">{t("login.subtitle")}</p>
      </div>

      {/* form */}
      <div className="mt-8 flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-[13px] font-bold text-ink">{t("login.identifier")}</label>
          <div className="flex items-center gap-2.5 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 transition-colors focus-within:border-brand-500 focus-within:bg-white">
            <AtSign className="h-5 w-5 text-muted" />
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              type="text"
              dir="ltr"
              placeholder={t("login.identifierPh")}
              className="h-12 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-bold text-ink">{t("login.password")}</label>
          <div className="flex items-center gap-2.5 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 transition-colors focus-within:border-brand-500 focus-within:bg-white">
            <Lock className="h-5 w-5 text-muted" />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={show ? "text" : "password"}
              dir="ltr"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="h-12 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label="toggle password"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-slate-100"
            >
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button onClick={() => router.push("/forgot")} className="text-[12.5px] font-bold text-brand-600">{t("login.forgot")}</button>
            <button onClick={codeLogin} className="text-[12.5px] font-bold text-brand-600">{t("login.codeLogin")}</button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-5 rounded-xl bg-red-50 px-3 py-2 text-center text-[13px] font-medium text-red-600">{error}</p>
      )}

      <motion.button
        whileTap={valid && !submitting ? { scale: 0.97 } : undefined}
        disabled={!valid || submitting}
        onClick={handleSubmit}
        className={`mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all ${
          valid && !submitting
            ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]"
            : "cursor-not-allowed bg-slate-100 text-slate-400"
        }`}
      >
        {submitting ? t("common.loading") : t("login.submit")}
      </motion.button>

      <p className="mt-auto pt-6 text-center text-[13px] text-muted">
        {t("login.noAccount")}{" "}
        <button onClick={() => router.push("/")} className="font-bold text-brand-600">
          {t("login.create")}
        </button>
      </p>
    </div>
  );
}
