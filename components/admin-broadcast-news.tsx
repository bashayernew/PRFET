"use client";

/**
 * The second broadcast box — the "PRFET News" channel.
 *
 * Sits under the existing admin box on the Messages page. Same targeting, but three things
 * the first box doesn't have:
 *   • its own sender identity, so recipients see "PRFET News" rather than the admin account
 *   • an image or video
 *   • a link, which can point at a member's profile, an ad, or any external site
 *
 * Its own file rather than more lines in admin-screen.tsx, which is already ~2,000.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Search, X, Image as ImageIcon, Link2, Loader2, Pencil, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { COUNTRIES, getCountry } from "@/lib/countries";
import { apiGet, apiPost, apiPatch, apiUpload, getAccessToken } from "@/lib/api";

type Channel = { id: string; displayName: string; avatarUrl: string | null };
type Hit = { id: string; name: string; email: string | null; phone: string | null };
type Scope = "user" | "countries" | "all";
type Tier = "all" | "premium" | "free";

export default function AdminBroadcastNews() {
  const { t, locale, dir } = useI18n();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const [scope, setScope] = useState<Scope>("all");
  const [tier, setTier] = useState<Tier>("all");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [countryQ, setCountryQ] = useState("");

  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const token = () => getAccessToken() || undefined;

  const loadChannel = useCallback(async () => {
    const res = await apiGet<{ channels: { news: Channel } }>("/api/admin/broadcast", token());
    if (res.ok && res.data?.channels?.news) setChannel(res.data.channels.news);
  }, []);
  useEffect(() => { loadChannel(); }, [loadChannel]);

  async function saveName() {
    const name = nameDraft.trim();
    if (!name) { setRenaming(false); return; }
    const res = await apiPatch<{ channel: Channel }>("/api/admin/broadcast", { channel: "news", displayName: name }, token());
    if (res.ok && res.data?.channel) setChannel(res.data.channel);
    setRenaming(false);
  }

  async function searchPeople() {
    if (q.trim().length < 2) return;
    const res = await apiGet<{ users: Hit[] }>(`/api/admin/users?q=${encodeURIComponent(q.trim())}`, token());
    if (res.ok && res.data?.users) setHits(res.data.users.slice(0, 8));
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await apiUpload<{ url: string }>("/api/upload", file, token());
    setUploading(false);
    if (res.ok && res.data?.url) {
      setMediaUrl(res.data.url);
      setMediaKind(file.type.startsWith("video") ? "video" : "image");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  const ready =
    body.trim().length > 0 &&
    (scope !== "user" || !!picked) &&
    (scope !== "countries" || countries.length > 0);

  async function send() {
    if (!ready || busy) return;
    // Sending to everyone is irreversible and potentially thousands of DMs — worth one
    // deliberate confirmation. (Note: confirm() blocks the JS thread in the Android
    // WebView, but the dashboard is used in a desktop browser, so it's safe here.)
    if (scope === "all" && !window.confirm(t("adm.bcConfirmAll"))) return;

    setBusy(true);
    setResult(null);
    const res = await apiPost<{ sent: number; total: number; from: string }>(
      "/api/admin/broadcast",
      {
        channel: "news",
        scope,
        tier,
        userId: scope === "user" ? picked?.id : undefined,
        countries: scope === "countries" ? countries : undefined,
        body: body.trim(),
        mediaUrl: mediaUrl ?? undefined,
        mediaKind: mediaUrl ? mediaKind : undefined,
        linkUrl: linkUrl.trim() || undefined,
      },
      token(),
    );
    setBusy(false);
    if (res.ok && res.data) {
      setResult(t("adm.bcSentN").replace("{n}", String(res.data.sent)));
      setBody(""); setLinkUrl(""); setMediaUrl(null);
    } else {
      setResult(t("common.error"));
    }
  }

  const countryList = countryQ.trim()
    ? COUNTRIES.filter((c) =>
        c[locale === "ar" ? "ar" : "en"].toLowerCase().includes(countryQ.trim().toLowerCase()) ||
        c.code.toLowerCase().includes(countryQ.trim().toLowerCase()),
      ).slice(0, 8)
    : [];

  return (
    <div dir={dir} className="mt-5 max-w-2xl rounded-3xl bg-white p-5 ring-1 ring-slate-200">
      {/* ===== which identity it arrives from ===== */}
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-full bg-brand-600 px-3 py-1 text-[11.5px] font-extrabold text-white">
          {t("adm.bcChannel2")}
        </span>
        {renaming ? (
          <>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
              autoFocus
              className="h-9 flex-1 rounded-xl border-2 border-slate-200 px-3 text-[13px] font-bold text-ink outline-none focus:border-brand-500"
            />
            <button onClick={saveName} className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
              <Check className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <span className="text-[14px] font-extrabold text-ink">{channel?.displayName ?? "…"}</span>
            <button
              onClick={() => { setNameDraft(channel?.displayName ?? ""); setRenaming(true); }}
              className="grid h-8 w-8 place-items-center rounded-xl text-muted hover:bg-slate-100"
              aria-label="rename"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      <p className="mb-4 text-[12px] font-medium leading-relaxed text-muted">{t("adm.bcChannel2Hint")}</p>

      {/* ===== who receives it ===== */}
      <div className="mb-3 flex gap-1.5 rounded-2xl bg-slate-100 p-1.5">
        {([
          { v: "user" as Scope, label: t("adm.bcScopeUser") },
          { v: "countries" as Scope, label: t("adm.bcScopeCountries") },
          { v: "all" as Scope, label: t("adm.bcScopeAll") },
        ]).map((o) => (
          <button key={o.v} onClick={() => setScope(o.v)}
            className={`flex-1 rounded-xl py-2 text-[12.5px] font-bold transition-colors ${scope === o.v ? "bg-brand-600 text-white" : "text-muted"}`}>
            {o.label}
          </button>
        ))}
      </div>

      {/* membership filter — meaningless for a single named person, so hidden there */}
      {scope !== "user" && (
        <div className="mb-4 flex gap-1.5 rounded-2xl bg-slate-100 p-1.5">
          {([
            { v: "all" as Tier, label: t("adm.bcTierAll") },
            { v: "premium" as Tier, label: t("adm.bcTierPremium") },
            { v: "free" as Tier, label: t("adm.bcTierFree") },
          ]).map((o) => (
            <button key={o.v} onClick={() => setTier(o.v)}
              className={`flex-1 rounded-xl py-2 text-[12.5px] font-bold transition-colors ${tier === o.v ? "bg-[#131743] text-white" : "text-muted"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}

      {/* pick one person */}
      {scope === "user" && (
        <div className="mb-4">
          {picked ? (
            <div className="flex items-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-2.5 ring-1 ring-brand-200">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-extrabold text-ink">{picked.name}</span>
                <span className="block truncate text-[11.5px] font-medium text-muted" dir="ltr">{picked.email ?? picked.phone ?? ""}</span>
              </span>
              <button onClick={() => setPicked(null)} aria-label="clear" className="grid h-7 w-7 place-items-center rounded-full bg-white text-red-600 ring-1 ring-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") searchPeople(); }}
                  placeholder={t("adm.grantSearchPh")}
                  className="h-11 flex-1 rounded-2xl border-2 border-slate-200 px-3.5 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500" />
                <button onClick={searchPeople} className="grid h-11 w-11 place-items-center rounded-2xl bg-[#131743] text-white active:scale-95">
                  <Search className="h-4 w-4" />
                </button>
              </div>
              {hits.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {hits.map((u) => (
                    <button key={u.id} onClick={() => { setPicked(u); setHits([]); setQ(""); }}
                      className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-start hover:bg-brand-50">
                      <span className="text-[13px] font-bold text-ink">{u.name}</span>
                      <span className="truncate text-[11px] font-medium text-muted" dir="ltr">{u.email ?? u.phone ?? ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* pick countries — one or many */}
      {scope === "countries" && (
        <div className="mb-4">
          {countries.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {countries.map((code) => {
                const c = getCountry(code);
                return (
                  <span key={code} className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-bold text-brand-700 ring-1 ring-brand-200">
                    {c ? `${c.flag} ${c[locale === "ar" ? "ar" : "en"]}` : code}
                    <button onClick={() => setCountries((l) => l.filter((x) => x !== code))} aria-label="remove">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <input value={countryQ} onChange={(e) => setCountryQ(e.target.value)}
            placeholder={t("adm.bcCountryPh")}
            className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3.5 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500" />
          {countryList.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {countryList.map((c) => (
                <button key={c.code}
                  onClick={() => { setCountries((l) => (l.includes(c.code) ? l : [...l, c.code])); setCountryQ(""); }}
                  className="rounded-xl bg-slate-50 px-3 py-2.5 text-start text-[13px] font-bold text-ink hover:bg-brand-50">
                  {c.flag} {c[locale === "ar" ? "ar" : "en"]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== the message ===== */}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4}
        placeholder={t("adm.bcBodyPh")}
        className="mb-3 w-full rounded-2xl border-2 border-slate-200 p-3.5 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500" />

      {/* media */}
      <div className="mb-3 flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*,video/*" onChange={upload} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-2 rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-[12.5px] font-extrabold text-ink disabled:opacity-50">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
          {t("adm.bcAddMedia")}
        </button>
        {mediaUrl && (
          <span className="flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-[12px] font-bold text-brand-700">
            {mediaKind === "video" ? "🎥" : "📷"}
            <button onClick={() => setMediaUrl(null)} aria-label="remove"><X className="h-3 w-3" /></button>
          </span>
        )}
      </div>

      {/* link */}
      <div className="mb-1 flex items-center gap-2">
        <Link2 className="h-4 w-4 shrink-0 text-muted" />
        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} dir="ltr"
          placeholder="https://…  /business/<id>"
          className="h-11 flex-1 rounded-2xl border-2 border-slate-200 px-3.5 text-[13px] font-medium text-ink outline-none focus:border-brand-500" />
      </div>
      <p className="mb-4 text-[11px] font-medium text-muted">{t("adm.bcLinkHint")}</p>

      <button onClick={send} disabled={!ready || busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {t("adm.bcSend")}
      </button>

      {result && <p className="mt-3 text-center text-[12.5px] font-bold text-ink">{result}</p>}
    </div>
  );
}
