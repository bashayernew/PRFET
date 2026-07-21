"use client";

// Shared building blocks for the Profile and Settings screens.
import { useState } from "react";
import { Check, Globe2, Link2, Pencil } from "lucide-react";
import { useI18n, type Locale } from "@/lib/i18n";
import { COUNTRIES, getCountry } from "@/lib/countries";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-2 px-1 text-[12px] font-bold uppercase tracking-wide text-muted">{title}</p>
      <div className="rounded-2xl border border-slate-100 bg-white px-3 py-1">{children}</div>
    </div>
  );
}

export function Row({ icon, label, children, last }: { icon: React.ReactNode; label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-3 ${last ? "" : "border-b border-slate-100"}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <span className="flex-1 text-[13px] font-medium text-muted">{label}</span>
      <div className="text-end">{children}</div>
    </div>
  );
}

export function EditRow({ icon, label, value, type = "text", ltr, onSave, last, colorStyle }: { icon: React.ReactNode; label: string; value: string; type?: string; ltr?: boolean; onSave: (v: string) => void; last?: boolean; colorStyle?: React.CSSProperties }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <div className={`flex items-center gap-3 py-3 ${last ? "" : "border-b border-slate-100"}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <span className="flex-1 text-[13px] font-medium text-muted">{label}</span>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            type={type}
            dir={ltr ? "ltr" : undefined}
            onKeyDown={(e) => { if (e.key === "Enter") { onSave(draft.trim()); setEditing(false); } }}
            className="h-8 w-36 rounded-lg border-2 border-brand-500 bg-white px-2 text-[13px] font-bold text-ink outline-none"
          />
          <button onClick={() => { onSave(draft.trim()); setEditing(false); }} className="text-[12px] font-bold text-brand-600">{t("profile.save")}</button>
        </div>
      ) : (
        <button onClick={() => { setDraft(value); setEditing(true); }} className="flex items-center gap-1.5 text-end text-[13.5px] font-bold text-ink" style={colorStyle}>
          <span dir={ltr ? "ltr" : undefined}>{value || "—"}</span>
          <Pencil className="h-3.5 w-3.5 shrink-0 text-brand-500" />
        </button>
      )}
    </div>
  );
}

export function CountryRow({ value, locale, onPick, last, label }: { value: string | null; locale: Locale; onPick: (code: string) => void; last?: boolean; label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = getCountry(value);
  const filtered = q ? COUNTRIES.filter((c) => c.ar.includes(q) || c.en.toLowerCase().includes(q.toLowerCase())) : COUNTRIES;
  return (
    <div className={last ? "" : "border-b border-slate-100"}>
      <div className="flex items-center gap-3 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Globe2 className="h-[18px] w-[18px]" /></span>
        <span className="flex-1 text-[13px] font-medium text-muted">{label ?? t("profile.country")}</span>
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
          {current ? `${current.flag} ${current[locale]}` : "—"}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-brand-500" />
        </button>
      </div>
      {open && (
        <div className="pb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("country.search")} className="mb-2 h-10 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 text-[13px] font-medium text-ink outline-none focus:border-brand-500 focus:bg-white" />
          <div className="no-scrollbar flex max-h-52 flex-col gap-1 overflow-y-auto">
            {filtered.map((c) => (
              <button key={c.code} onClick={() => { onPick(c.code); setOpen(false); setQ(""); }} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-start ${value === c.code ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                <span className="text-lg leading-none">{c.flag}</span>
                <span className={`flex-1 text-[13.5px] font-bold ${value === c.code ? "text-brand-700" : "text-ink"}`}>{c[locale]}</span>
                {value === c.code && <Check className="h-4 w-4 text-brand-600" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5 rounded-2xl bg-slate-100 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold transition-all ${on ? "bg-white text-brand-700 shadow-sm" : "text-muted"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ icon, label, hint, value, onChange, last }: { icon: React.ReactNode; label: string; hint: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-3 ${last ? "" : "border-b border-slate-100"}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold text-ink">{label}</p>
        <p className="text-[11.5px] leading-snug text-muted">{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? "bg-brand-500" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow transition-all ${value ? "start-[22px]" : "start-0.5"}`} />
      </button>
    </div>
  );
}

export function SocialInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 px-3 transition-colors focus-within:border-brand-500 focus-within:bg-white">
      <Link2 className="h-4 w-4 shrink-0 text-muted" />
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }} dir="ltr" placeholder="https://…"
        className="h-10 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-muted" />
    </div>
  );
}
