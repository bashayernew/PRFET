"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowLeft, Mail, Phone, MessageSquare, Info, ShieldAlert,
  HelpCircle, Scale, Send, Copy, Check, Pencil,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPost, getAccessToken } from "@/lib/api";
import BottomNav from "@/components/bottom-nav";

type Settings = {
  adminEmail: string; supportPhone: string; whatsapp: string;
  aboutAr: string; aboutEn: string;
  complaintsInfo: string; inquiriesInfo: string;
  legalRepName: string; legalRepEmail: string; legalRepPhone: string;
  legalRepAvatar?: string; legalRepUserId?: string;
  address: string;
};

type Kind = "complaint" | "suggestion" | "call" | "legal";

/** Contact the administration — everything here is editable from the admin dashboard. */
export default function ContactScreen() {
  const router = useRouter();
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [s, setS] = useState<Settings | null>(null);
  const [kind, setKind] = useState<Kind>("suggestion");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    apiGet<{ settings: Settings }>("/api/settings").then((r) => {
      if (r.ok && r.data?.settings) setS(r.data.settings);
    });
    // the owner gets a pencil to edit this whole page
    const token = getAccessToken();
    if (token) apiGet<{ user: { isAdmin?: boolean } }>("/api/auth/me", token).then((r) => {
      if (r.ok && r.data?.user) setIsAdmin(!!r.data.user.isAdmin);
    });
  }, []);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2400); }

  async function send() {
    if (body.trim().length < 5 || busy) return;
    setBusy(true);
    const res = await apiPost("/api/support", {
      kind,
      subject: subject.trim() || undefined,
      body: body.trim(),
      contact: contact.trim() || undefined,
    }, getAccessToken() || undefined);
    setBusy(false);
    if (res.ok) { flash(t("contact.sent")); setSubject(""); setBody(""); setContact(""); }
    else flash(t("common.error"));
  }

  async function copyEmail() {
    if (!s?.adminEmail) return;
    try {
      await navigator.clipboard.writeText(s.adminEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  }

  if (!ready) return null;

  const about = (locale === "ar" ? s?.aboutAr : s?.aboutEn) || "";
  const kindInfo = kind === "complaint" ? s?.complaintsInfo : kind === "suggestion" ? s?.inquiriesInfo : "";

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="shrink-0 bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-5 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/home")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="flex-1 text-[17px] font-extrabold text-white">{t("contact.title")}</h1>
          {isAdmin && (
            <button
              onClick={() => router.push("/admin")}
              aria-label={t("admin.edit")}
              title={t("admin.edit")}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-1.5 ps-[48px] text-[12.5px] font-medium text-white/75">{t("contact.subtitle")}</p>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
        {/* how to reach the admin */}
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-100">
          {s?.adminEmail ? (
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Mail className="h-[18px] w-[18px]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-bold text-muted">{t("contact.adminEmail")}</span>
                <a href={`mailto:${s.adminEmail}`} dir="ltr" className="block truncate text-[13.5px] font-extrabold text-ink">{s.adminEmail}</a>
              </span>
              <button onClick={copyEmail} aria-label={t("post.copyLink")} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-muted active:scale-95">
                {copied ? <Check className="h-4 w-4 text-emerald-600" strokeWidth={3} /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          ) : (
            <p className="px-4 py-4 text-[13px] font-medium text-muted">{t("contact.noneYet")}</p>
          )}

          {/* phone / WhatsApp / address deliberately removed — the page is the message
              form + the reason bar; everything lands in the admin's inbox and email. */}
        </div>

        {/* about the app */}
        {about && (
          <div className="mt-4 rounded-3xl bg-white p-4 ring-1 ring-slate-100">
            <p className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-extrabold text-ink">
              <Info className="h-4 w-4 text-brand-600" /> {t("contact.about")}
            </p>
            <p className="whitespace-pre-line text-[13px] font-medium leading-relaxed text-muted">{about}</p>
          </div>
        )}

        {/* write to the admin */}
        <div id="contact-form" className="mt-4 rounded-3xl bg-white p-4 ring-1 ring-slate-100">
          <p className="mb-3 text-[13.5px] font-extrabold text-ink">{t("contact.writeUs")}</p>

          <div className="mb-3 flex gap-1.5 rounded-2xl bg-slate-100 p-1.5">
            {([
              { k: "complaint" as Kind, icon: <ShieldAlert className="h-3.5 w-3.5" />, label: t("contact.complaint") },
              { k: "suggestion" as Kind, icon: <HelpCircle className="h-3.5 w-3.5" />, label: t("contact.suggestion") },
              { k: "call" as Kind, icon: <Phone className="h-3.5 w-3.5" />, label: t("contact.callRequest") },
              { k: "legal" as Kind, icon: <Scale className="h-3.5 w-3.5" />, label: t("contact.legal") },
            ]).map((o) => (
              <button
                key={o.k}
                onClick={() => setKind(o.k)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[12px] font-bold transition-colors ${kind === o.k ? "bg-brand-600 text-white" : "text-muted"}`}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>

          {/* pressing "legal" reveals the lawyer — his card + poster, right above the form */}
          {kind === "legal" && (
            <div className="mb-3 overflow-hidden rounded-2xl ring-1 ring-slate-100">
              <div className="flex items-center gap-3 bg-gradient-to-l from-violet-600 to-violet-500 px-4 py-3">
                {s?.legalRepAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.legalRepAvatar} alt="" className="h-10 w-10 shrink-0 rounded-2xl object-cover ring-2 ring-white/40" />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/20 text-white">
                    <Scale className="h-5 w-5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold text-white/80">{t("contact.legalRep")}</span>
                  {s?.legalRepName && <span className="block truncate text-[14.5px] font-extrabold text-white">{s.legalRepName}</span>}
                </span>
              </div>
              {/* the poster — file lives at public/legal-rep.jpg */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/legal-rep.jpg"
                alt={s?.legalRepName || ""}
                className="w-full"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <div className="p-3">
                <p className="mb-2 text-[12px] font-medium text-muted">{t("contact.legalHint")}</p>
                {/* email only — his personal number is never shown; the message form is right below */}
                {/* his in-app account, when the admin has linked one — straight into a DM */}
                {s?.legalRepUserId && (
                  <button
                    onClick={() => router.push(`/messages/${s.legalRepUserId}`)}
                    className="mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 text-[13px] font-bold text-white active:scale-[0.99]"
                  >
                    <MessageSquare className="h-4 w-4" /> {t("contact.messageLawyer")}
                  </button>
                )}
                {s?.legalRepEmail && (
                  <a href={`mailto:${s.legalRepEmail}`} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-violet-50 text-[13px] font-bold text-violet-700 active:scale-[0.99]">
                    <Mail className="h-4 w-4" /> <span dir="ltr">{s.legalRepEmail}</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {kindInfo && <p className="mb-3 rounded-2xl bg-brand-50 p-3 text-[12px] font-medium leading-snug text-brand-800">{kindInfo}</p>}

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("contact.subjectPh")}
            className="mb-2.5 h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder={t("contact.bodyPh")}
            className="mb-2.5 w-full resize-none rounded-2xl border-2 border-slate-200 bg-white p-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            dir="ltr"
            placeholder={t("contact.contactPh")}
            className="mb-3 h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500"
          />

          <button
            onClick={send}
            disabled={body.trim().length < 5 || busy}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-40 active:scale-[0.99]"
          >
            <Send className={`h-4 w-4 ${dir === "rtl" ? "-scale-x-100" : ""}`} /> {t("contact.send")}
          </button>
        </div>
      </div>

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}

      <BottomNav active="contact" />
    </div>
  );
}
