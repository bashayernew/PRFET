"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Lock, Plus, Trash2, Crown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost, apiDelete, getAccessToken } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

type Item = { id: string; title: string; body: string; createdAt: string };

/**
 * The personal vault — a subscriber's private box. Save a label + content (a phone number,
 * a note, a code). Everything is stored under the member's own account and only they can
 * read it back. Non-subscribers (or when the admin turns the vault off) see a locked state.
 */
export default function VaultScreen() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const [items, setItems] = useState<Item[]>([]);
  const [blocked, setBlocked] = useState<null | "premium_only" | "disabled">(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken() || undefined;
    apiGet<{ items?: Item[]; error?: string }>("/api/vault", token).then((res) => {
      setLoading(false);
      if (res.ok && res.data?.items) { setItems(res.data.items); setBlocked(null); }
      else if (res.data?.error === "premium_only") setBlocked("premium_only");
      else if (res.data?.error === "disabled") setBlocked("disabled");
    });
  }, [ready]);

  async function add() {
    const tt = title.trim(), bb = body.trim();
    if (!tt || !bb || busy) return;
    setBusy(true);
    const res = await apiPost<{ item: Item }>("/api/vault", { title: tt, body: bb }, getAccessToken() || undefined);
    setBusy(false);
    if (res.ok && res.data?.item) {
      setItems((prev) => [res.data!.item, ...prev]);
      setTitle(""); setBody("");
    }
  }

  async function remove(id: string) {
    if (!confirm(t("vault.deleteConfirm"))) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    await apiDelete(`/api/vault?id=${encodeURIComponent(id)}`, getAccessToken() || undefined);
  }

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-6 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/profile")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
            <Back className="h-5 w-5" strokeWidth={2.4} />
          </button>
          <h1 className="flex items-center gap-2 text-[18px] font-extrabold text-white"><Lock className="h-5 w-5" /> {t("vault.title")}</h1>
        </div>
        <p className="mt-2 text-[12.5px] font-medium text-white/85">{t("vault.subtitle")}</p>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-8 pt-4">
        {blocked ? (
          <div className="mt-6 rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-100">
            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-500">
              <Crown className="h-8 w-8" />
            </span>
            <p className="text-[14.5px] font-extrabold text-ink">{t(blocked === "disabled" ? "vault.off" : "vault.locked")}</p>
            <p className="mt-1 text-[12.5px] font-medium leading-relaxed text-muted">{t(blocked === "disabled" ? "vault.offHint" : "vault.lockedHint")}</p>
            {blocked === "premium_only" && (
              <button onClick={() => router.push("/subscribe")} className="mt-4 w-full rounded-2xl bg-brand-600 py-3 text-[14px] font-bold text-white active:scale-95">
                {t("premium.upgrade")}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* add form */}
            <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("vault.titlePh")}
                maxLength={120}
                className="w-full rounded-2xl bg-slate-100 px-4 py-3 text-[14px] font-semibold text-ink outline-none placeholder:text-muted focus:bg-slate-100"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("vault.bodyPh")}
                maxLength={4000}
                rows={3}
                className="mt-2 w-full resize-none rounded-2xl bg-slate-100 px-4 py-3 text-[14px] font-medium text-ink outline-none placeholder:text-muted focus:bg-slate-100"
              />
              <button
                onClick={add}
                disabled={busy || !title.trim() || !body.trim()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3 text-[14px] font-bold text-white active:scale-95 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> {t("vault.save")}
              </button>
            </div>

            {/* list */}
            {loading ? null : items.length === 0 ? (
              <p className="mt-8 text-center text-[13px] font-medium text-muted">{t("vault.empty")}</p>
            ) : (
              <div className="mt-4 flex flex-col gap-2.5">
                {items.map((it) => (
                  <div key={it.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-extrabold text-ink">{it.title}</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] font-medium text-muted">{it.body}</p>
                      </div>
                      <button onClick={() => remove(it.id)} aria-label={t("vault.delete")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-red-500 active:scale-95">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
