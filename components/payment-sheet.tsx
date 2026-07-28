"use client";

import { useState } from "react";
import { CreditCard, Lock, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * A checkout sheet shown before an ad/job/seeker goes live. Fake gateway (no real
 * money). `onPaid` runs the actual publish — if it navigates away, we're done; if it
 * returns, the sheet stays so the user can retry.
 */
export default function PaymentSheet({ amount, onPaid, onClose }: { amount: number; onPaid: () => Promise<void> | void; onClose: () => void }) {
  const { t, dir } = useI18n();
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [holder, setHolder] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = card.replace(/\s/g, "").length >= 12 && exp.length >= 4 && cvc.length >= 3 && holder.trim().length >= 2;

  async function pay() {
    if (!valid || busy) return;
    setBusy(true);
    try { await onPaid(); } finally { setBusy(false); }
  }

  return (
    <div dir={dir} className="fixed inset-0 z-50 grid place-items-end bg-black/50 sm:place-items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-2 text-[15px] font-extrabold text-ink"><CreditCard className="h-5 w-5 text-brand-600" /> {t("premium.card")}</p>
          <button onClick={onClose} aria-label={t("close")} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-ink"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-4 flex items-center justify-between rounded-2xl bg-brand-50 px-4 py-3">
          <span className="text-[13px] font-bold text-ink">{t("pay.total")}</span>
          <span dir="ltr" className="text-[18px] font-extrabold text-brand-700">${amount}</span>
        </div>

        <PayField label={t("premium.cardNum")} value={card} onChange={(v) => setCard(v.replace(/[^\d ]/g, "").slice(0, 19))} placeholder="4242 4242 4242 4242" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <PayField label={t("premium.exp")} value={exp} onChange={(v) => setExp(v.replace(/[^\d/]/g, "").slice(0, 5))} placeholder="MM/YY" />
          <PayField label={t("premium.cvc")} value={cvc} onChange={(v) => setCvc(v.replace(/\D/g, "").slice(0, 4))} placeholder="123" />
        </div>
        <div className="mt-3"><PayField label={t("premium.cardName")} value={holder} onChange={setHolder} placeholder="—" /></div>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-muted"><Lock className="h-3.5 w-3.5" /> {t("premium.demo")}</p>

        <button onClick={pay} disabled={!valid || busy}
          className={`mt-4 h-12 w-full rounded-2xl text-[15px] font-bold transition-all ${valid && !busy ? "bg-gradient-to-l from-brand-700 to-brand-500 text-white" : "cursor-not-allowed bg-slate-200 text-slate-400"}`}>
          {busy ? t("common.loading") : `${t("pay.pay")} $${amount}`}
        </button>
      </div>
    </div>
  );
}

function PayField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-bold text-ink">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} dir="ltr"
        className="h-12 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 text-[15px] font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted focus:border-brand-500 focus:bg-white" />
    </div>
  );
}
