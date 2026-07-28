"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowLeft, Briefcase, UserPlus, Search, MapPin, Wallet, GraduationCap,
  Check, ChevronDown, UploadCloud, MessageCircle, FileText, Globe2,
} from "lucide-react";
import { useI18n, ld, type Locale } from "@/lib/i18n";
import { COUNTRIES, getCountry } from "@/lib/countries";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, apiUpload, getAccessToken } from "@/lib/api";
import BottomNav from "@/components/bottom-nav";
import PaymentSheet from "@/components/payment-sheet";

type Mode = "hub" | "post-job" | "post-cv" | "search";

type Job = {
  id: string; companyId: string; companyName: string; imageUrl: string | null; title: string;
  typeKey: string; degree: string | null; experience: string | null; salary: string | null;
  nationality: string | null; gender: string | null; country: string | null; location: string | null;
  birthFrom: number | null; birthTo: number | null;
};

type Seeker = {
  id: string; userId: string; imageUrl: string | null; name: string; birthDate: string | null;
  degree: string | null; nationality: string | null; gender: string; experience: string | null;
  title: string | null; countries: string[]; cvUrl: string | null;
};

export default function JobsScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [mode, setMode] = useState<Mode>("hub");
  const [toast, setToast] = useState<string | null>(null);
  const [jobsOn, setJobsOn] = useState(true); // dashboard switch: posting jobs/CVs on/off (search stays)

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => setJobsOn(d?.settings?.jobsEnabled !== false))
      .catch(() => {});
  }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="shrink-0 bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-5 pt-[calc(env(safe-area-inset-top)+16px)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (mode === "hub" ? router.push("/home") : setMode("hub"))}
            aria-label={t("back")}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white active:scale-95"
          >
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="flex items-center gap-2 text-[18px] font-extrabold text-white">
            <Briefcase className="h-5 w-5" />
            {t(mode === "post-job" ? "jobs.postJob" : mode === "post-cv" ? "jobs.postCv" : mode === "search" ? "jobs.searchTitle" : "jobs.title")}
          </h1>
        </div>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-6 pt-5">
        {mode === "hub" && (
          <Hub onPick={setMode} t={t} />
        )}
        {mode === "post-job" && <PostJob t={t} locale={locale} jobsOn={jobsOn} onDone={(m) => { flash(m); setMode("hub"); }} />}
        {mode === "post-cv" && <PostCv t={t} locale={locale} jobsOn={jobsOn} onDone={(m) => { flash(m); setMode("hub"); }} />}
        {mode === "search" && (
          <SearchPane
            t={t}
            locale={locale}
            onOpenProfile={(uid) => router.push(`/business/${uid}`)}
            onMessage={(uid) => router.push(`/messages/${uid}`)}
            onOpenJob={(jobId) => router.push(`/job/${jobId}`)}
          />
        )}
      </div>

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}

      <BottomNav active="home" />
    </div>
  );
}

function Hub({ onPick, t }: { onPick: (m: Mode) => void; t: (k: string) => string }) {
  const cards: { key: Mode; icon: React.ReactNode; title: string; sub: string; tint: string }[] = [
    { key: "post-job", icon: <Briefcase className="h-6 w-6" />, title: t("jobs.postJob"), sub: t("jobs.postJobSub"), tint: "from-brand-700 to-brand-500" },
    { key: "post-cv", icon: <UserPlus className="h-6 w-6" />, title: t("jobs.postCv"), sub: t("jobs.postCvSub"), tint: "from-violet-700 to-violet-500" },
    { key: "search", icon: <Search className="h-6 w-6" />, title: t("jobs.searchTitle"), sub: t("jobs.searchSub"), tint: "from-emerald-700 to-emerald-500" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {cards.map((c, i) => (
        <motion.button
          key={c.key}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          onClick={() => onPick(c.key)}
          className={`flex items-center gap-4 rounded-3xl bg-gradient-to-l ${c.tint} p-4 text-start shadow-sm active:scale-[0.99]`}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/20 text-white">{c.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold text-white">{c.title}</span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-white/80">{c.sub}</span>
          </span>
        </motion.button>
      ))}

      {/* the two listing portals were removed — vacancies & seekers now live in the Search page */}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, optional, type = "text", t }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; optional?: boolean; type?: string; t: (k: string) => string }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-[12.5px] font-bold text-ink">
        {label}{optional && <span className="font-medium text-muted"> ({t("jobs.optional")})</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500"
      />
    </label>
  );
}

function GenderPick({ value, onChange, withAny, t, label }: { value: string; onChange: (v: string) => void; withAny?: boolean; t: (k: string) => string; label?: string }) {
  const opts = withAny ? ["male", "female", "any"] : ["male", "female"];
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[12.5px] font-bold text-ink">{label ?? t("register.gender")}</p>
      <div className="flex gap-2">
        {opts.map((g) => (
          <button
            key={g}
            onClick={() => onChange(g)}
            className={`flex-1 rounded-2xl py-2.5 text-[13px] font-bold transition-colors ${value === g ? "bg-brand-600 text-white" : "bg-white text-muted ring-1 ring-slate-200"}`}
          >
            {t(g === "male" ? "register.male" : g === "female" ? "register.female" : "jobs.any")}
          </button>
        ))}
      </div>
    </div>
  );
}

function CountryPick({ label, values, onChange, single, locale, t, optional }: { label: string; values: string[]; onChange: (v: string[]) => void; single?: boolean; locale: Locale; t: (k: string) => string; optional?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  // close the dropdown when tapping anywhere outside it
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const list = q ? COUNTRIES.filter((c) => c.ar.includes(q) || c.en.toLowerCase().includes(q.toLowerCase())) : COUNTRIES;
  const shown = values.length === 0
    ? t("country.search")
    : values.length === 1
    ? (() => { const c = getCountry(values[0]); return c ? `${c.flag} ${c[locale]}` : values[0]; })()
    : `${values.length} ${t("ads.countries")}`;

  return (
    <div className="mb-3" ref={boxRef}>
      <p className="mb-1.5 text-[12.5px] font-bold text-ink">
        {label}{optional && <span className="font-medium text-muted"> ({t("jobs.optional")})</span>}
      </p>
      <button onClick={() => setOpen((o) => !o)} className="flex h-11 w-full items-center justify-between rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[13.5px] font-bold text-ink">
        <span className="truncate">{shown}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 rounded-2xl border-2 border-slate-200 bg-white p-2.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("country.search")} className="mb-2 h-9 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 text-[13px] font-medium text-ink outline-none focus:border-brand-500" />
          <div className="no-scrollbar flex max-h-48 flex-col gap-1 overflow-y-auto">
            {list.map((c) => {
              const on = values.includes(c.code);
              return (
                <button
                  key={c.code}
                  onClick={() => {
                    if (single) { onChange([c.code]); setOpen(false); return; }
                    onChange(on ? values.filter((x) => x !== c.code) : [...values, c.code]);
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-start ${on ? "bg-brand-50" : "hover:bg-slate-50"}`}
                >
                  <span className="text-lg leading-none">{c.flag}</span>
                  <span className={`flex-1 text-[13px] font-bold ${on ? "text-brand-700" : "text-ink"}`}>{c[locale]}</span>
                  {on && <Check className="h-4 w-4 text-brand-600" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PostJob({ t, locale, jobsOn, onDone }: { t: (k: string) => string; locale: Locale; jobsOn: boolean; onDone: (msg: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fee, setFee] = useState(1.99); // monthly posting fee from the dashboard
  const [freeLeft, setFreeLeft] = useState(0); // free job-post credits gifted by the admin
  const [payOpen, setPayOpen] = useState(false);
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => { if (typeof d?.settings?.priceJobPost === "number") setFee(d.settings.priceJobPost); })
      .catch(() => {});
    const tok = getAccessToken();
    if (tok) apiGet<{ user: { freeJobPostLeft?: number } }>("/api/auth/me", tok).then((r) => { if (r.ok && r.data?.user) setFreeLeft(r.data.user.freeJobPostLeft ?? 0); });
  }, []);

  const [companyName, setCompanyName] = useState("");
  const [title, setTitle] = useState("");
  const [degree, setDegree] = useState("");
  const [experience, setExperience] = useState("");
  const [salary, setSalary] = useState("");
  const [nationality, setNationality] = useState<string[]>([]);
  const [country, setCountry] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [gender, setGender] = useState("any");
  const [birthFrom, setBirthFrom] = useState("");
  const [birthTo, setBirthTo] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length >= 2 && companyName.trim().length >= 2 && country.length > 0;

  async function publish() {
    if (!valid || busy) return;
    setBusy(true);
    const token = getAccessToken() || undefined;
    let imageUrl: string | undefined;
    if (file) {
      const up = await apiUpload<{ url: string }>("/api/upload", file, token);
      if (up.ok && up.data?.url) imageUrl = up.data.url;
    }
    const res = await apiPost("/api/jobs", {
      title: title.trim(),
      companyName: companyName.trim(),
      imageUrl,
      degree: degree.trim() || undefined,
      experience: experience.trim() || undefined,
      salary: salary.trim() || undefined,
      nationality: nationality.join(",") || undefined,
      gender,
      country: country.join(",") || undefined,
      location: city.trim() || undefined,
      birthFrom: birthFrom ? Number(birthFrom) : undefined,
      birthTo: birthTo ? Number(birthTo) : undefined,
    }, token);
    setBusy(false);
    if (res.ok) onDone(t("jobs.posted"));
  }

  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-bold text-ink">{t("jobs.image")} <span className="font-medium text-muted">({t("jobs.optional")})</span></p>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        setFile(f);
        if (preview) URL.revokeObjectURL(preview);
        setPreview(f ? URL.createObjectURL(f) : null);
      }} />
      <button onClick={() => fileRef.current?.click()} className={`mb-4 flex w-full flex-col items-center rounded-3xl border-2 border-dashed border-slate-300 bg-white ${preview ? "overflow-hidden p-0" : "gap-1.5 py-6"}`}>
        {preview ? (
          <img src={preview} alt="" className="max-h-44 w-full bg-slate-100 object-contain" />
        ) : (
          <>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><UploadCloud className="h-5 w-5" /></span>
            <span className="text-[12.5px] font-bold text-ink">{t("jobs.image")}</span>
          </>
        )}
      </button>

      <Field t={t} label={t("jobs.companyName")} value={companyName} onChange={setCompanyName} />
      <Field t={t} label={t("jobs.role")} value={title} onChange={setTitle} placeholder={t("jobs.rolePh")} />
      <Field t={t} label={t("jobs.degree")} value={degree} onChange={setDegree} optional placeholder={t("jobs.degreePh")} />
      <Field t={t} label={t("jobs.experience")} value={experience} onChange={setExperience} optional placeholder={t("jobs.experiencePh")} />
      <Field t={t} label={t("jobs.salary")} value={salary} onChange={setSalary} optional placeholder="1000" />
      <CountryPick t={t} locale={locale} label={t("jobs.nationalityWanted")} values={nationality} onChange={setNationality} optional />
      <CountryPick t={t} locale={locale} label={t("jobs.employeeLocation")} values={country} onChange={setCountry} />
      <Field t={t} label={t("jobs.city")} value={city} onChange={setCity} optional placeholder={t("jobs.cityPh")} />
      <GenderPick t={t} value={gender} onChange={setGender} withAny label={t("jobs.genderWanted")} />

      <p className="mb-1.5 text-[12.5px] font-bold text-ink">{t("jobs.birthRange")} <span className="font-medium text-muted">({t("jobs.optional")})</span></p>
      <div className="mb-4 flex items-center gap-2">
        <input value={birthFrom} onChange={(e) => setBirthFrom(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1990" dir="ltr" className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-center text-[14px] font-bold text-ink outline-none focus:border-brand-500" />
        <span className="text-[13px] font-bold text-muted">—</span>
        <input value={birthTo} onChange={(e) => setBirthTo(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2005" dir="ltr" className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-center text-[14px] font-bold text-ink outline-none focus:border-brand-500" />
      </div>

      {fee > 0 && (
        <p className="mb-2 text-center text-[12px] font-bold text-brand-700" dir="ltr">
          {t("jobs.postFee")}: ${fee} · 30 {t("adm.days")}
        </p>
      )}
      <button onClick={() => { if (jobsOn && fee > 0 && freeLeft <= 0) setPayOpen(true); else publish(); }} disabled={!valid || busy} className={`w-full rounded-2xl py-4 text-[15px] font-bold text-white transition-colors ${valid && !busy ? "bg-brand-600" : "bg-slate-300"}`}>
        {t("jobs.publish")}
      </button>

      {payOpen && <PaymentSheet amount={fee} onPaid={async () => { setPayOpen(false); await publish(); }} onClose={() => setPayOpen(false)} />}
    </div>
  );
}

function PostCv({ t, locale, jobsOn, onDone }: { t: (k: string) => string; locale: Locale; jobsOn: boolean; onDone: (msg: string) => void }) {
  const photoRef = useRef<HTMLInputElement>(null);
  const cvRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [cv, setCv] = useState<File | null>(null);
  const [fee, setFee] = useState(0.99); // monthly seeker-listing fee from the dashboard
  const [freeLeft, setFreeLeft] = useState(0); // free seeker-ad credits gifted by the admin
  const [payOpen, setPayOpen] = useState(false);
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => { if (typeof d?.settings?.priceSeekerAd === "number") setFee(d.settings.priceSeekerAd); })
      .catch(() => {});
    const tok = getAccessToken();
    if (tok) apiGet<{ user: { freeSeekerLeft?: number } }>("/api/auth/me", tok).then((r) => { if (r.ok && r.data?.user) setFreeLeft(r.data.user.freeSeekerLeft ?? 0); });
  }, []);

  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [degree, setDegree] = useState("");
  const [nationality, setNationality] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [gender, setGender] = useState("");
  const [experience, setExperience] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length >= 2 && gender !== "" && countries.length > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    const token = getAccessToken() || undefined;
    let imageUrl: string | undefined;
    let cvUrl: string | undefined;
    if (photo) {
      const up = await apiUpload<{ url: string }>("/api/upload", photo, token);
      if (up.ok && up.data?.url) imageUrl = up.data.url;
    }
    if (cv) {
      const up = await apiUpload<{ url: string }>("/api/upload", cv, token);
      if (up.ok && up.data?.url) cvUrl = up.data.url;
    }
    const res = await apiPost("/api/job-seekers", {
      name: name.trim(),
      imageUrl,
      birthDate: birthDate || undefined,
      degree: degree.trim() || undefined,
      nationality: nationality[0],
      gender,
      experience: experience.trim() || undefined,
      title: title.trim() || undefined,
      countries,
      cvUrl,
    }, token);
    setBusy(false);
    if (res.ok) onDone(t("jobs.cvSent"));
  }

  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-bold text-ink">{t("jobs.photo")} <span className="font-medium text-muted">({t("jobs.optional")})</span></p>
      <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        setPhoto(f);
        if (preview) URL.revokeObjectURL(preview);
        setPreview(f ? URL.createObjectURL(f) : null);
      }} />
      <button onClick={() => photoRef.current?.click()} className="mb-4 flex w-full items-center gap-3 rounded-3xl border-2 border-dashed border-slate-300 bg-white p-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-50 text-brand-600">
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <UploadCloud className="h-5 w-5" />
          )}
        </span>
        <span className="text-[12.5px] font-bold text-ink">{t("jobs.photo")}</span>
      </button>

      <Field t={t} label={t("jobs.name")} value={name} onChange={setName} />
      <Field t={t} label={t("register.dob")} value={birthDate} onChange={setBirthDate} type="date" optional />
      <Field t={t} label={t("jobs.myRole")} value={title} onChange={setTitle} optional placeholder={t("jobs.rolePh")} />
      <Field t={t} label={t("jobs.degree")} value={degree} onChange={setDegree} optional placeholder={t("jobs.degreePh")} />
      <CountryPick t={t} locale={locale} label={t("jobs.myNationality")} values={nationality} onChange={setNationality} single optional />
      <CountryPick t={t} locale={locale} label={t("jobs.applyCountries")} values={countries} onChange={setCountries} />
      <GenderPick t={t} value={gender} onChange={setGender} />
      <Field t={t} label={t("jobs.experience")} value={experience} onChange={setExperience} optional placeholder={t("jobs.experiencePh")} />

      <p className="mb-1.5 text-[12.5px] font-bold text-ink">{t("jobs.cv")} <span className="font-medium text-muted">({t("jobs.optional")})</span></p>
      <input ref={cvRef} type="file" accept=".pdf,.doc,.docx,image/*" hidden onChange={(e) => setCv(e.target.files?.[0] ?? null)} />
      <button onClick={() => cvRef.current?.click()} className="mb-4 flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-3.5">
        <FileText className="h-5 w-5 shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1 truncate text-start text-[13px] font-bold text-ink">{cv ? cv.name : t("jobs.uploadCv")}</span>
        {cv && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
      </button>

      {fee > 0 && (
        <p className="mb-2 text-center text-[12px] font-bold text-violet-700" dir="ltr">
          {t("jobs.seekerFee")}: ${fee} · 30 {t("adm.days")}
        </p>
      )}
      <button onClick={() => { if (jobsOn && fee > 0 && freeLeft <= 0) setPayOpen(true); else submit(); }} disabled={!valid || busy} className={`w-full rounded-2xl py-4 text-[15px] font-bold text-white transition-colors ${valid && !busy ? "bg-violet-600" : "bg-slate-300"}`}>
        {t("jobs.send")}
      </button>

      {payOpen && <PaymentSheet amount={fee} onPaid={async () => { setPayOpen(false); await submit(); }} onClose={() => setPayOpen(false)} />}
    </div>
  );
}

function SearchPane({ t, locale, onOpenProfile, onMessage, onOpenJob }: { t: (k: string) => string; locale: Locale; onOpenProfile: (uid: string) => void; onMessage: (uid: string) => void; onOpenJob: (jobId: string) => void }) {
  const [lookingFor, setLookingFor] = useState<"employee" | "job" | null>(null);

  const [title, setTitle] = useState("");
  const [degree, setDegree] = useState("");
  const [gender, setGender] = useState("");
  const [nationality, setNationality] = useState<string[]>([]);
  const [location, setLocation] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [experience, setExperience] = useState("");

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [seekers, setSeekers] = useState<Seeker[] | null>(null);
  const [busy, setBusy] = useState(false);

  const employeeValid = location.length > 0 && gender !== "";
  const jobValid = countries.length > 0;

  async function run() {
    const token = getAccessToken() || undefined;
    setBusy(true);
    if (lookingFor === "employee") {
      const qs = new URLSearchParams();
      if (title.trim()) qs.set("title", title.trim());
      if (degree.trim()) qs.set("degree", degree.trim());
      if (experience.trim()) qs.set("experience", experience.trim());
      if (nationality[0]) qs.set("nationality", nationality[0]);
      qs.set("location", location[0]);
      qs.set("gender", gender);
      const res = await apiGet<{ seekers: Seeker[] }>(`/api/job-seekers?${qs.toString()}`, token);
      setSeekers(res.ok && res.data?.seekers ? res.data.seekers : []);
      setJobs(null);
    } else {
      const qs = new URLSearchParams();
      if (title.trim()) qs.set("title", title.trim());
      if (degree.trim()) qs.set("degree", degree.trim());
      if (gender) qs.set("gender", gender);
      if (countries.length) qs.set("country", countries.join(","));
      const res = await apiGet<{ jobs: Job[] }>(`/api/jobs?${qs.toString()}`, token);
      setJobs(res.ok && res.data?.jobs ? res.data.jobs : []);
      setSeekers(null);
    }
    setBusy(false);
  }

  if (!lookingFor) {
    return (
      <div className="flex flex-col gap-3">
        <p className="mb-1 text-[14px] font-extrabold text-ink">{t("jobs.whichAreYou")}</p>
        <button onClick={() => setLookingFor("employee")} className="flex items-center gap-3 rounded-3xl bg-white p-5 text-start shadow-sm ring-1 ring-slate-100 active:scale-[0.99]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600"><UserPlus className="h-5 w-5" /></span>
          <span className="flex-1 text-[14.5px] font-extrabold text-ink">{t("jobs.needEmployee")}</span>
        </button>
        <button onClick={() => setLookingFor("job")} className="flex items-center gap-3 rounded-3xl bg-white p-5 text-start shadow-sm ring-1 ring-slate-100 active:scale-[0.99]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-600"><Briefcase className="h-5 w-5" /></span>
          <span className="flex-1 text-[14.5px] font-extrabold text-ink">{t("jobs.needJob")}</span>
        </button>
      </div>
    );
  }

  const canSearch = lookingFor === "employee" ? employeeValid : jobValid;

  return (
    <div>
      <button onClick={() => { setLookingFor(null); setJobs(null); setSeekers(null); }} className="mb-3 text-[12.5px] font-bold text-brand-600">
        ← {t(lookingFor === "employee" ? "jobs.needEmployee" : "jobs.needJob")}
      </button>

      <Field t={t} label={t("jobs.role")} value={title} onChange={setTitle} optional placeholder={t("jobs.rolePh")} />
      <Field t={t} label={t("jobs.degree")} value={degree} onChange={setDegree} optional placeholder={t("jobs.degreePh")} />

      {lookingFor === "employee" ? (
        <>
          <CountryPick t={t} locale={locale} label={t("jobs.nationalityWanted")} values={nationality} onChange={setNationality} single optional />
          <CountryPick t={t} locale={locale} label={t("jobs.whereEmployee")} values={location} onChange={setLocation} single />
          <Field t={t} label={t("jobs.experience")} value={experience} onChange={setExperience} optional placeholder={t("jobs.experiencePh")} />
          <GenderPick t={t} value={gender} onChange={setGender} />
        </>
      ) : (
        <>
          <CountryPick t={t} locale={locale} label={t("jobs.applyCountries")} values={countries} onChange={setCountries} />
          <GenderPick t={t} value={gender} onChange={setGender} withAny label={t("jobs.genderWanted")} />
        </>
      )}

      <button onClick={run} disabled={!canSearch || busy} className={`mb-5 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold text-white ${canSearch && !busy ? "bg-emerald-600" : "bg-slate-300"}`}>
        <Search className="h-5 w-5" /> {t("discover.search")}
      </button>

      {seekers && (
        seekers.length === 0 ? (
          <p className="py-10 text-center text-[13px] font-bold text-muted">{t("discover.empty")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {seekers.map((s) => (
              <div key={s.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                <div className="flex items-center gap-3">
                  <button onClick={() => onOpenProfile(s.userId)} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-50 text-[16px] font-extrabold text-brand-600">
                    {s.imageUrl ? (
                      <img src={s.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (s.name || "•").charAt(0).toUpperCase()
                    )}
                  </button>
                  <button onClick={() => onOpenProfile(s.userId)} className="min-w-0 flex-1 text-start">
                    <p className="truncate text-[15px] font-extrabold text-ink">{s.name}</p>
                    {s.title && <p className="truncate text-[12px] font-medium text-muted">{s.title}</p>}
                  </button>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-muted">
                  {s.degree && <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" /> {s.degree}</span>}
                  {s.experience && <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {s.experience}</span>}
                  {s.nationality && <span className="flex items-center gap-1"><Globe2 className="h-3.5 w-3.5" /> {getCountry(s.nationality)?.[locale] ?? s.nationality}</span>}
                  {s.countries.length > 0 && (
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {s.countries.map((c) => getCountry(c)?.flag ?? c).join(" ")}</span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={() => onMessage(s.userId)} className="flex items-center justify-center gap-1.5 rounded-2xl bg-brand-600 py-2.5 text-[13px] font-bold text-white active:scale-95">
                    <MessageCircle className="h-4 w-4" /> {t("merchant.message")}
                  </button>
                  {s.cvUrl ? (
                    <a href={s.cvUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 py-2.5 text-[13px] font-bold text-ink active:scale-95">
                      <FileText className="h-4 w-4" /> {t("jobs.cv")}
                    </a>
                  ) : (
                    <button onClick={() => onOpenProfile(s.userId)} className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 py-2.5 text-[13px] font-bold text-ink active:scale-95">
                      {t("meet.viewProfile")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {jobs && (
        jobs.length === 0 ? (
          <p className="py-10 text-center text-[13px] font-bold text-muted">{t("discover.empty")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {jobs.map((j) => (
              <div key={j.id} onClick={() => onOpenJob(j.id)} role="button" className="cursor-pointer overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100 active:scale-[0.99]">
                {j.imageUrl && <img src={j.imageUrl} alt="" className="h-32 w-full object-cover" />}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-extrabold text-ink">{j.title}</p>
                      <button onClick={(e) => { e.stopPropagation(); onOpenProfile(j.companyId); }} className="truncate text-[12.5px] font-bold text-brand-600">{j.companyName}</button>
                    </div>
                    <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700">
                      {t(j.typeKey === "part" ? "jobs.part" : j.typeKey === "remote" ? "jobs.remote" : "jobs.full")}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] font-bold text-muted">
                    {j.country && (
                      <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {getCountry(j.country)?.[locale] ?? j.country}{j.location ? ` · ${j.location}` : ""}</span>
                    )}
                    {j.salary && <span className="flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> {j.salary}</span>}
                    {j.degree && <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" /> {j.degree}</span>}
                    {j.experience && <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {j.experience}</span>}
                    {j.nationality && <span className="flex items-center gap-1"><Globe2 className="h-3.5 w-3.5" /> {getCountry(j.nationality)?.[locale] ?? j.nationality}</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={(e) => { e.stopPropagation(); onOpenJob(j.id); }} className="flex items-center justify-center gap-1.5 rounded-2xl bg-brand-600 py-2.5 text-[13px] font-bold text-white active:scale-95">
                      <Briefcase className="h-4 w-4" /> {t("jobs.details")}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onMessage(j.companyId); }} className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 py-2.5 text-[13px] font-bold text-ink active:scale-95">
                      <MessageCircle className="h-4 w-4" /> {t("merchant.message")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
