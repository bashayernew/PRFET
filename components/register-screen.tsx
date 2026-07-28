"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  User,
  Store,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  Check,
  MapPin,
  Camera,
  ImagePlus,
  Flag,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { apiPost } from "@/lib/api";
import { useOpenCountries } from "@/lib/use-open-countries";

type Account = "personal" | "business";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.06 + i * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] } }),
};

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const phoneOk = (v: string) => /^\+?[0-9]{7,15}$/.test(v.replace(/[\s()-]/g, ""));

// Resize a picked image to a small JPEG data URL (avatar) — no server upload needed at sign-up.
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 256;
      const scale = Math.min(max / img.width, max / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no ctx"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default function RegisterScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const { countries: openCountries } = useOpenCountries();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const Forward = dir === "rtl" ? ArrowLeft : ArrowRight;

  const [account, setAccount] = useState<Account>("personal");

  const [avatar, setAvatar] = useState<string | null>(null);
  const [name, setName] = useState(""); // public / business name
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [agree, setAgree] = useState(false);
  const [nationality, setNationality] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [address, setAddress] = useState("");


  const [touchedContact, setTouchedContact] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const a = localStorage.getItem("herot.accountType") as Account | null;
    if (a === "personal" || a === "business") setAccount(a);
  }, []);

  // Draft: restore the form when coming back (e.g. from /verify). Password & photo excluded.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("herot.regDraft");
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.name === "string") setName(d.name);
      if (typeof d.email === "string") setEmail(d.email);
      if (typeof d.nationality === "string") setNationality(d.nationality);
      if (d.gender === "male" || d.gender === "female") setGender(d.gender);
      if (typeof d.address === "string") setAddress(d.address);
    } catch { /* ignore */ }
  }, []);

  // Draft: save as the user types.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "herot.regDraft",
        JSON.stringify({ name, email, nationality, gender, address })
      );
    } catch { /* ignore */ }
  }, [name, email, nationality, gender, address]);

  const isBusiness = account === "business";
  const contactValid = emailOk(email);
  const contactError = touchedContact && email.length > 0 && !emailOk(email);
  const passwordOk = password.length === 0 || password.length >= 8;

  const valid =
    name.trim().length >= 4 && // client: names must be at least 4 characters
    contactValid &&
    passwordOk &&
    agree &&
    (isBusiness ? address.trim().length >= 2 : true);

  async function pickAvatar(file: File) {
    try {
      setAvatar(await fileToAvatar(file));
    } catch {
      /* ignore */
    }
  }

  async function handleSubmit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);

    const identifier = email.trim().toLowerCase();

    // signup is now minimal and email-only: name, nationality, email (+ optional password).
    // Country and all preference toggles live in Settings after signup.
    const res = await apiPost<{ devCode?: string; error?: string }>("/api/auth/register", {
      accountType: account,
      contactMethod: "email",
      email: email.trim().toLowerCase(),
      password: password || undefined,
      displayName: name.trim(),
      avatarUrl: avatar || undefined,
      nationality: !isBusiness && nationality ? nationality : undefined,
      gender: !isBusiness && gender ? gender : undefined,
      address: isBusiness ? address.trim() : undefined,
      locale,
    });

    if (res.ok) {
      localStorage.setItem("herot.pendingId", identifier);
      localStorage.setItem("herot.name", name.trim());
      localStorage.removeItem("herot.devCode");
      router.push("/verify");
      return;
    }
    const code = res.data?.error;
    setError(
      code === "country_closed"
        ? t("auth.countryClosed")
        : res.status === 409 || code === "identifier_taken"
          ? t("register.identifierTaken")
          : res.status === 429 || code === "rate_limited"
            ? t("register.tooMany")
            : code === "invalid_input"
              ? t("register.invalidInput")
              : t("register.failed")
    );
    setSubmitting(false);
  }

  let i = 0;

  return (
    <div dir={dir} className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-[calc(env(safe-area-inset-top)+18px)]">
      {/* top bar */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/")} aria-label={t("back")} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-ink active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <div className="flex flex-1 items-center gap-1.5">
          <span className="h-1.5 flex-1 rounded-full bg-brand-500" />
          <span className="h-1.5 flex-1 rounded-full bg-slate-200" />
        </div>
        <span className="text-[12px] font-bold text-muted">{ld(1, locale)} / {ld(2, locale)}</span>
      </div>

      {/* heading */}
      <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show" className="mt-6 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600">
          {isBusiness ? <Store className="h-5 w-5" /> : <User className="h-5 w-5" />}
        </span>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-[12px] font-bold text-brand-700">
          {isBusiness ? t("account.business.title") : t("account.personal.title")}
        </span>
      </motion.div>
      <motion.h1 variants={fadeUp} custom={i++} initial="hidden" animate="show" className="mt-3 text-2xl font-extrabold text-ink">
        {t("register.title")}
      </motion.h1>

      {/* photo */}
      <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show" className="mt-5 flex flex-col items-center gap-2">
        <button type="button" onClick={() => avatarRef.current?.click()} className="relative grid h-20 w-20 place-items-center rounded-full bg-brand-50 ring-2 ring-brand-100">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <Camera className="h-7 w-7 text-brand-400" />
          )}
          <span className="absolute -bottom-0.5 -end-0.5 grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-white ring-2 ring-white">
            <ImagePlus className="h-4 w-4" />
          </span>
        </button>
        <span className="text-[12px] font-bold text-muted">{t("register.uploadPhoto")}</span>
        <input ref={avatarRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickAvatar(f); }} />
      </motion.div>

      {/* form */}
      <div className="mt-6 flex flex-col gap-4">
        {/* personal/owner name removed from signup — only the display name/username is collected (per client) */}
        <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show">
          <Field
            label={isBusiness ? t("register.businessName") : t("register.publicName")}
            icon={isBusiness ? <Store className="h-5 w-5" /> : <User className="h-5 w-5" />}
            value={name}
            onChange={setName}
            placeholder={isBusiness ? t("register.businessNamePh") : t("register.publicNamePh")}
          />
        </motion.div>

        {!isBusiness && (
          <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show">
            <label className="mb-1.5 block text-[13px] font-bold text-ink">{t("register.gender")}</label>
            <Segmented
              options={[{ value: "male", label: t("register.male") }, { value: "female", label: t("register.female") }]}
              value={gender}
              onChange={(v) => setGender(v as "male" | "female")}
            />
          </motion.div>
        )}
        {!isBusiness && (
          <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show">
            <label className="mb-1.5 block text-[13px] font-bold text-ink">{t("register.nationality")}</label>
            <div className="flex items-center gap-2.5 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 transition-colors focus-within:border-brand-500 focus-within:bg-white">
              <Flag className="h-5 w-5 text-muted" />
              <select value={nationality} onChange={(e) => setNationality(e.target.value)} className="h-12 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none">
                <option value="">{t("country.search")}</option>
                {openCountries.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c[locale]}</option>
                ))}
              </select>
            </div>
          </motion.div>
        )}
        {isBusiness && (
          <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show">
            <Field label={t("register.address")} icon={<MapPin className="h-5 w-5" />} value={address} onChange={setAddress} placeholder={t("register.addressPh")} />
          </motion.div>
        )}

        {/* email — the only sign-up method; the verification code is sent here */}
        <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show">
          <Field label={t("register.email")} icon={<Mail className="h-5 w-5" />} value={email} onChange={setEmail} onBlur={() => setTouchedContact(true)} placeholder={t("register.emailPh")} type="email" ltrInput error={contactError ? t("register.emailInvalid") : undefined} />
        </motion.div>

        {/* password (optional) */}
        <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show">
          <Field
            label={t("register.passwordOptional")}
            icon={<Lock className="h-5 w-5" />}
            value={password}
            onChange={setPassword}
            placeholder={t("register.passwordPh")}
            type={show ? "text" : "password"}
            ltrInput
            hint={t("register.passwordHint")}
            error={password.length > 0 && password.length < 8 ? t("register.passwordHint") : undefined}
            trailing={
              <button type="button" onClick={() => setShow((s) => !s)} aria-label="toggle password" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-slate-100">
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            }
          />
        </motion.div>

        {/* privacy & preferences */}
        <motion.div variants={fadeUp} custom={i++} initial="hidden" animate="show" className="mt-1 rounded-2xl border-2 border-slate-100 bg-slate-50/60 p-4">
          <p className="text-[13px] font-extrabold text-ink">{t("register.privacy")}</p>
          {/* visibility, distance, media, most-viewed lock, show-address — all moved to Settings (per client) */}
        </motion.div>

        {/* terms */}
        <motion.button type="button" variants={fadeUp} custom={i++} initial="hidden" animate="show" onClick={() => setAgree((a) => !a)} className="flex items-start gap-2.5 text-start">
          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition-all ${agree ? "border-brand-500 bg-brand-500" : "border-slate-300 bg-white"}`}>
            {agree && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
          </span>
          <span className="text-[12.5px] leading-relaxed text-muted">{t("register.terms")}</span>
        </motion.button>
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-center text-[13px] font-medium text-red-600">{error}</p>}

      <motion.button
        variants={fadeUp}
        custom={i++}
        initial="hidden"
        animate="show"
        whileTap={valid && !submitting ? { scale: 0.97 } : undefined}
        disabled={!valid || submitting}
        onClick={handleSubmit}
        className={`group mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all ${
          valid && !submitting ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white shadow-[0_16px_30px_-10px_rgba(40,46,158,0.6)]" : "cursor-not-allowed bg-slate-100 text-slate-400"
        }`}
      >
        {submitting ? t("common.loading") : t("register.create")}
        {!submitting && <Forward className="h-5 w-5" strokeWidth={2.4} />}
      </motion.button>

      <p className="mt-4 text-center text-[13px] text-muted">
        {t("register.haveAccount")}{" "}
        <button onClick={() => router.push("/login")} className="font-bold text-brand-600">{t("register.login")}</button>
      </p>
    </div>
  );
}

function Field({ label, icon, value, onChange, onBlur, placeholder, type = "text", ltrInput, hint, error, trailing }: {
  label: string; icon: React.ReactNode; value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; type?: string; ltrInput?: boolean; hint?: string; error?: string; trailing?: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-bold text-ink">{label}</label>
      <div className={`flex items-center gap-2.5 rounded-2xl border-2 bg-slate-50 px-3.5 transition-colors focus-within:bg-white ${error ? "border-red-400 focus-within:border-red-500" : "border-slate-200 focus-within:border-brand-500"}`}>
        <span className="text-muted">{icon}</span>
        <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} type={type} dir={ltrInput ? "ltr" : undefined} className="h-12 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-muted placeholder:font-normal" />
        {trailing}
      </div>
      {error ? <p className="mt-1 text-[12px] font-medium text-red-500">{error}</p> : hint ? <p className="mt-1 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: { value: string; label: string; icon?: React.ReactNode }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5 rounded-2xl bg-slate-100 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-bold transition-all ${active ? "bg-white text-brand-700 shadow-sm" : "text-muted"}`}>
            {o.icon}{o.label}
          </button>
        );
      })}
    </div>
  );
}

