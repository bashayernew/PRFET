"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowLeft, Briefcase, MapPin, Wallet, GraduationCap, Globe2,
  MessageCircle, Check, Users, Send, User as UserIcon, Calendar, Trash2, FileText,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { getCountry } from "@/lib/countries";
import { useRequireAuth } from "@/lib/use-auth";
import { apiDelete, apiGet, apiPost, getAccessToken } from "@/lib/api";
import { vipStyle } from "@/lib/vip";

type Company = { id: string; displayName: string; avatarUrl: string | null; category: string | null; bio: string | null; isPremium?: boolean; textColor?: string | null };
type Applicant = { id: string; displayName: string; avatarUrl: string | null; cvUrl: string | null; note: string | null; createdAt: string };
type Job = {
  id: string; companyId: string; company: Company | null; companyName: string; imageUrl: string | null;
  title: string; degree: string | null; experience: string | null; salary: string | null;
  nationality: string | null; gender: string | null; country: string | null; location: string | null;
  birthFrom: number | null; birthTo: number | null; createdAt: string;
  applicantCount: number; mine: boolean; applied: boolean; applicants: Applicant[];
  status: string; expiresAt: string | null;
};

/** One job, in full — and the button that applies for it. */
export default function JobScreen({ id }: { id: string }) {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [job, setJob] = useState<Job | null>(null);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [applyFee, setApplyFee] = useState(0); // dashboard-set; 0 = free

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json())
      .then((d) => { if (typeof d?.settings?.priceJobApply === "number") setApplyFee(d.settings.priceJobApply); })
      .catch(() => {});
  }, []);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2200); }

  async function load() {
    const res = await apiGet<{ job: Job }>(`/api/jobs/${id}`, getAccessToken() || undefined);
    if (res.ok && res.data?.job) setJob(res.data.job);
    else setGone(true);
  }

  useEffect(() => { if (ready) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ready, id]);

  async function apply() {
    if (busy || !job) return;
    setBusy(true);
    const res = await apiPost(`/api/jobs/${id}/apply`, { note: note.trim() || undefined }, getAccessToken() || undefined);
    setBusy(false);
    if (res.ok) { flash(t("jobs.applied")); setNote(""); load(); }
    else flash(t("common.error"));
  }

  async function removeJob() {
    if (!confirm(t("jobs.deleteConfirm"))) return;
    await apiDelete(`/api/jobs/${id}`, getAccessToken() || undefined);
    router.push("/jobs");
  }

  if (!ready) return null;

  const countries = (job?.country || "").split(",").filter(Boolean);
  const nats = (job?.nationality || "").split(",").filter(Boolean);

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="flex shrink-0 items-center gap-3 bg-gradient-to-b from-brand-700 to-brand-600 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+14px)]">
        <button onClick={() => router.back()} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
          <Back className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <p className="flex items-center gap-2 text-[16px] font-extrabold text-white">
          <Briefcase className="h-4 w-4" /> {t("jobs.details")}
        </p>
        {job?.mine && (
          <button onClick={removeJob} aria-label={t("jobs.delete")} className="ms-auto grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
        {gone && <p className="py-24 text-center text-[13.5px] font-bold text-muted">{t("jobs.gone")}</p>}

        {job && (
          <>
            {job.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={job.imageUrl} alt="" className="mb-4 h-44 w-full rounded-3xl bg-black object-cover" />
            )}

            <h1 className="text-[20px] font-extrabold leading-snug text-ink">{job.title}</h1>

            <button
              onClick={() => router.push(`/business/${job.companyId}`)}
              className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-start ring-1 ring-slate-100 active:scale-[0.99]"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-50 text-[15px] font-extrabold text-brand-600">
                {job.company?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={job.company.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (job.companyName || "•").charAt(0).toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-extrabold text-ink" style={vipStyle(job.company)}>{job.companyName}</span>
                <span className="block truncate text-[12px] font-medium text-muted">{t("jobs.company")}</span>
              </span>
              <UserIcon className="h-4 w-4 shrink-0 text-muted" />
            </button>

            {/* the details */}
            <div className="mt-3 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
              <Row icon={<Wallet className="h-4 w-4" />} label={t("jobs.salary")} value={job.salary || "—"} />
              <Row icon={<GraduationCap className="h-4 w-4" />} label={t("jobs.degree")} value={job.degree || "—"} />
              <Row icon={<Briefcase className="h-4 w-4" />} label={t("jobs.experience")} value={job.experience || "—"} />
              <Row
                icon={<MapPin className="h-4 w-4" />}
                label={t("jobs.employeeLocation")}
                value={countries.length ? countries.map((c) => `${getCountry(c)?.flag ?? ""} ${getCountry(c)?.[locale] ?? c}`).join("، ") : "—"}
              />
              {job.location && <Row icon={<MapPin className="h-4 w-4" />} label={t("jobs.city")} value={job.location} />}
              <Row
                icon={<Globe2 className="h-4 w-4" />}
                label={t("jobs.nationalityWanted")}
                value={nats.length ? nats.map((c) => `${getCountry(c)?.flag ?? ""} ${getCountry(c)?.[locale] ?? c}`).join("، ") : t("jobs.any")}
              />
              <Row
                icon={<UserIcon className="h-4 w-4" />}
                label={t("jobs.genderWanted")}
                value={job.gender === "male" ? t("register.male") : job.gender === "female" ? t("register.female") : t("jobs.any")}
              />
              <Row
                icon={<Calendar className="h-4 w-4" />}
                label={t("jobs.birthRange")}
                value={job.birthFrom || job.birthTo ? `${ld(job.birthFrom ?? "—", locale)} — ${ld(job.birthTo ?? "—", locale)}` : "—"}
                last
              />
            </div>

            {/* the company sees who applied */}
            {job.mine ? (
              <div className="mt-4">
                {/* the ad ran its month — one tap pays the fee and relaunches it */}
                {(job.status === "expired" || (job.expiresAt && new Date(job.expiresAt) <= new Date())) && (
                  <div className="mb-3 rounded-2xl bg-orange-50 p-3.5 ring-1 ring-orange-200">
                    <p className="text-[13px] font-bold text-orange-700">{t("notif.jobExpBody")}</p>
                    <button
                      onClick={async () => {
                        const res = await apiPost(`/api/jobs/${id}/renew`, {}, getAccessToken() || undefined);
                        if (res.ok) { setToast(t("jobs.renewDone")); load(); }
                      }}
                      className="mt-2.5 h-11 w-full rounded-xl bg-brand-600 text-[13.5px] font-extrabold text-white active:scale-[0.99]"
                    >
                      {t("jobs.renew")}
                    </button>
                  </div>
                )}
                <p className="mb-2 flex items-center gap-1.5 text-[13.5px] font-extrabold text-ink">
                  <Users className="h-4 w-4 text-brand-600" /> {t("jobs.applicants")} ({ld(job.applicantCount, locale)})
                </p>
                {job.applicants.length === 0 ? (
                  <p className="rounded-2xl bg-white py-6 text-center text-[13px] font-bold text-muted ring-1 ring-slate-100">{t("jobs.noApplicants")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {job.applicants.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-100">
                        <button onClick={() => router.push(`/business/${a.id}`)} className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-[14px] font-extrabold text-brand-600">
                          {a.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.avatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            (a.displayName || "•").charAt(0).toUpperCase()
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-extrabold text-ink">{a.displayName}</p>
                          {a.note && <p className="truncate text-[12px] font-medium text-muted">{a.note}</p>}
                        </div>
                        {a.cvUrl && (
                          <a href={a.cvUrl} target="_blank" rel="noopener noreferrer" aria-label={t("jobs.cv")} className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-600">
                            <FileText className="h-4 w-4" />
                          </a>
                        )}
                        <button onClick={() => router.push(`/messages/${a.id}`)} aria-label={t("home.message")} className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white active:scale-95">
                          <MessageCircle className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* everyone else: apply */
              <div className="mt-4">
                {job.applied ? (
                  <p className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 py-3.5 text-[14px] font-bold text-emerald-700 ring-1 ring-emerald-100">
                    <Check className="h-4 w-4" strokeWidth={3} /> {t("jobs.alreadyApplied")}
                  </p>
                ) : (
                  <>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      placeholder={t("jobs.notePh")}
                      className="mb-2.5 w-full resize-none rounded-2xl border-2 border-slate-200 bg-white p-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500"
                    />
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        onClick={apply}
                        disabled={busy}
                        className="flex items-center justify-center gap-1.5 rounded-2xl bg-brand-600 py-3.5 text-[14.5px] font-bold text-white disabled:opacity-50 active:scale-[0.99]"
                      >
                        <Send className={`h-4 w-4 ${dir === "rtl" ? "-scale-x-100" : ""}`} /> {t("jobs.apply")}
                      </button>
                      <button
                        onClick={() => router.push(`/messages/${job.companyId}`)}
                        className="flex items-center justify-center gap-1.5 rounded-2xl bg-white py-3.5 text-[14.5px] font-bold text-brand-700 ring-1 ring-slate-200 active:scale-[0.99]"
                      >
                        <MessageCircle className="h-4 w-4" /> {t("home.message")}
                      </button>
                    </div>
                    <p className="mt-2 text-center text-[11.5px] font-medium text-muted">{t("jobs.applyHint")}</p>
                    {applyFee > 0 && (
                      <p className="mt-1 text-center text-[11.5px] font-bold text-brand-700" dir="ltr">
                        {t("jobs.applyFee")}: ${applyFee}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}
    </div>
  );
}

function Row({ icon, label, value, last }: { icon: React.ReactNode; label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${last ? "" : "border-b border-slate-100"}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <span className="flex-1 text-[12.5px] font-medium text-muted">{label}</span>
      <span className="max-w-[55%] truncate text-end text-[13px] font-bold text-ink">{value}</span>
    </div>
  );
}
