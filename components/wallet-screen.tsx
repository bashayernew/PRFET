"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Wallet, Plus, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, getAccessToken } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { isNative, initPurchases, buy, restore } from "@/lib/iap";

type Pack = { productId: string; valueCents: number; value: number };

/**
 * The credit wallet screen.
 *
 * Shows the member's balance and the top-up packs. On the native apps a tap opens Apple/Play's
 * purchase sheet (via RevenueCat); the balance is credited server-side from the webhook, so we
 * just re-read it a moment later. On the web there's no in-app top-up (FastSpring handles web),
 * so the packs are shown as "open the app to top up".
 */
export default function WalletScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const MAX_BALANCE = 500; // dollars — a wallet can't hold more than this

  const [balance, setBalance] = useState(0);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [native, setNative] = useState(false);
  const [enabled, setEnabled] = useState(true); // admin can close the wallet from the dashboard
  const [busy, setBusy] = useState<string | null>(null); // productId being purchased
  const [msg, setMsg] = useState<string | null>(null);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 2600); }

  async function refresh() {
    const token = getAccessToken() || undefined;
    const res = await apiGet<{ balance: number; packs: Pack[] }>("/api/credits", token);
    if (res.ok && res.data) { setBalance(res.data.balance ?? 0); setPacks(res.data.packs || []); }
    setLoading(false);
  }

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken() || undefined;
    // Start RevenueCat for this member (native only; a no-op on the web) so a purchase is
    // attributed to their account and the webhook can credit the right wallet.
    isNative().then((n) => {
      setNative(n);
      if (n) apiGet<{ user: { id: string } }>("/api/auth/me", token).then((r) => {
        if (r.ok && r.data?.user?.id) initPurchases(r.data.user.id);
      });
    });
    // Respect the admin's wallet on/off switch.
    fetch("/api/settings").then((r) => r.json()).then((d) => setEnabled(d?.settings?.walletEnabled !== false)).catch(() => {});
    refresh();
  }, [ready]);

  async function topUp(pack: Pack) {
    if (busy) return;
    if (!native) { flash(t("wallet.appOnly")); return; }
    if (balance + pack.value > MAX_BALANCE) { flash(t("wallet.full")); return; } // $500 cap
    setBusy(pack.productId);
    const r = await buy(pack.productId, getAccessToken() || "");
    setBusy(null);
    if (r.ok) { flash(t("wallet.added")); setTimeout(refresh, 1500); }
    else if (!r.cancelled) flash(t("wallet.failed"));
  }

  async function doRestore() {
    await restore(getAccessToken() || "");
    flash(t("wallet.restored"));
    setTimeout(refresh, 1200);
  }

  if (!ready) return null;

  return (
    <div dir={dir} className="flex h-[100dvh] flex-col bg-slate-50">
      {/* header */}
      <div className="shrink-0 bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-6 pt-[calc(env(safe-area-inset-top)+16px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} aria-label={t("back")} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="text-[18px] font-extrabold text-white">{t("wallet.title")}</h1>
        </div>

        {/* balance card */}
        <div className="mt-4 rounded-3xl bg-white/12 p-5 ring-1 ring-white/15">
          <div className="flex items-center gap-2 text-white/80">
            <Wallet className="h-4 w-4" />
            <span className="text-[12.5px] font-bold">{t("wallet.balance")}</span>
          </div>
          <p dir="ltr" className="mt-1 text-end text-[34px] font-extrabold leading-none text-white">${balance.toFixed(2)}</p>
        </div>
      </div>

      {/* body */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-8 pt-5">
        <p className="mb-1 text-[13px] font-extrabold text-ink">{t("wallet.topUp")}</p>
        <p className="mb-3 text-[11.5px] font-medium leading-snug text-muted">
          {native ? t("wallet.topUpHint") : t("wallet.appOnly")} {t("wallet.max")}
        </p>

        {!enabled ? (
          <p className="py-8 text-center text-[13px] font-medium text-muted">{t("wallet.disabled")}</p>
        ) : loading ? (
          <p className="py-8 text-center text-[13px] font-medium text-muted">…</p>
        ) : packs.length === 0 ? (
          <p className="py-8 text-center text-[13px] font-medium text-muted">{t("wallet.noPacks")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {packs.map((p) => (
              <button
                key={p.productId}
                onClick={() => topUp(p)}
                disabled={busy === p.productId}
                className="flex flex-col items-center gap-1 rounded-3xl bg-white p-5 ring-1 ring-slate-100 active:scale-[0.98] disabled:opacity-50"
              >
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Plus className="h-5 w-5" /></span>
                <span dir="ltr" className="mt-1 text-[20px] font-extrabold text-ink">${p.value.toFixed(0)}</span>
                <span className="text-[11px] font-bold text-brand-600">{busy === p.productId ? t("wallet.processing") : t("wallet.add")}</span>
              </button>
            ))}
          </div>
        )}

        {native && (
          <button onClick={doRestore} className="mx-auto mt-6 flex items-center gap-1.5 text-[12.5px] font-bold text-muted">
            <RotateCcw className="h-3.5 w-3.5" /> {t("wallet.restore")}
          </button>
        )}

        <p className="mt-6 text-center text-[11px] font-medium leading-relaxed text-muted">{t("wallet.note")}</p>
      </div>

      {msg && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {msg}
        </div>
      )}
    </div>
  );
}
