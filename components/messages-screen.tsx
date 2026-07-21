"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Search, UserPlus, Lock, LockOpen } from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { getBusiness } from "@/lib/data";
import { catIcon } from "@/lib/cat-icons";
import { vipStyle } from "@/lib/vip";
import BottomNav from "@/components/bottom-nav";
import { useRequireAuth } from "@/lib/use-auth";
import { apiDelete, apiGet, apiPatch, apiPost, getAccessToken } from "@/lib/api";

type Convo = {
  peerId: string; lastBody: string | null; lastAt: string; lastFromMe: boolean; unread: number;
  peerName: string | null; peerAvatar: string | null; peerCategory: string | null; peerOnline: boolean;
  peerAllowed?: boolean;
  peerIsPremium?: boolean; peerTextColor?: string | null;
};
type Person = { id: string; displayName: string; avatarUrl: string | null; category: string | null; accountType?: string };

function fmtListTime(iso: string, locale: "ar" | "en") {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return ld(`${hh}:${mm}`, locale);
  }
  return ld(`${d.getDate()}/${d.getMonth() + 1}`, locale);
}

function convoName(c: Convo, locale: "ar" | "en") {
  if (c.peerName) return c.peerName;
  const b = getBusiness(c.peerId);
  return b ? (locale === "ar" ? b.ar : b.en) : c.peerId;
}

export default function MessagesScreen() {
  const { t, dir, locale } = useI18n();
  const ready = useRequireAuth();
  const [query, setQuery] = useState("");
  const [convos, setConvos] = useState<Convo[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [dmClosed, setDmClosed] = useState(false);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    const res = await apiGet<{ conversations: Convo[] }>("/api/conversations", token);
    if (res.ok && res.data?.conversations) setConvos(res.data.conversations);
    setLoading(false);
  }, []);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  // my inbox switch, right here in the inbox
  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ user: { dmClosed: boolean } }>("/api/auth/me", token).then((res) => {
      if (res.ok && res.data?.user) setDmClosed(res.data.user.dmClosed);
    });
  }, [ready]);

  async function toggleInbox() {
    const next = !dmClosed;
    setDmClosed(next);
    await apiPatch("/api/auth/me", { dmClosed: next }, getAccessToken() || undefined);
  }

  // let one person through (or take it back) straight from the inbox
  async function toggleAllow(peerId: string, allowed: boolean) {
    setConvos((cs) => cs.map((c) => (c.peerId === peerId ? { ...c, peerAllowed: !allowed } : c)));
    const token = getAccessToken() || undefined;
    if (allowed) await apiDelete(`/api/dm-allow/${peerId}`, token);
    else await apiPost(`/api/dm-allow/${peerId}`, {}, token);
  }

  const q = query.trim();

  // Search the directory (people + businesses) to start a new chat.
  useEffect(() => {
    if (!q) { setPeople([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const token = getAccessToken() || undefined;
      const res = await apiGet<{ users: Person[] }>(`/api/users?scope=all&q=${encodeURIComponent(q)}`, token);
      if (!cancelled && res.ok && res.data?.users) setPeople(res.data.users);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);

  const list = useMemo(() => {
    if (!q) return convos;
    const ql = q.toLowerCase();
    return convos.filter((c) => convoName(c, locale).toLowerCase().includes(ql));
  }, [q, convos, locale]);

  // People results that aren't already an open conversation.
  const newPeople = useMemo(() => {
    const existing = new Set(convos.map((c) => c.peerId));
    return people.filter((p) => !existing.has(p.id));
  }, [people, convos]);

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-white">
      {/* header */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-600 px-5 pb-6 pt-[calc(env(safe-area-inset-top)+18px)]">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-[22px] font-extrabold text-white">{t("messages.title")}</h1>
          {/* open / closed inbox — one tap */}
          <button
            onClick={toggleInbox}
            aria-label={t("dm.closed")}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold active:scale-95 ${
              dmClosed ? "bg-amber-400 text-amber-950" : "bg-white/15 text-white"
            }`}
          >
            {dmClosed ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            {dmClosed ? t("dm.inboxClosed") : t("dm.inboxOpen")}
          </button>
        </div>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("messages.searchPh")}
            className="h-12 w-full rounded-2xl border-0 bg-white ps-12 pe-4 text-[14px] font-medium text-ink shadow-lg outline-none placeholder:font-normal placeholder:text-muted"
          />
        </div>
      </div>

      {dmClosed && (
        <div className="flex items-center gap-1.5 bg-amber-50 px-5 py-2 text-[11.5px] font-bold text-amber-700">
          <Lock className="h-3.5 w-3.5 shrink-0" /> {t("dm.closedBanner")}
        </div>
      )}

      {/* list */}
      <div className="no-scrollbar flex-1 overflow-y-auto">
        {/* existing conversations */}
        <div className="flex flex-col">
          {list.map((c) => {
            const Icon = catIcon(c.peerCategory ?? getBusiness(c.peerId)?.catKey ?? "cat.other");
            const name = convoName(c, locale);
            const preview = c.lastBody ?? "";
            return (
              <Link key={c.peerId} href={`/messages/${c.peerId}`} className="flex items-center gap-3 px-5 py-3.5 active:bg-slate-50 border-b border-slate-100">
                <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-50" style={{ height: 52, width: 52 }}>
                  {c.peerAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.peerAvatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon className="h-6 w-6 text-brand-600" strokeWidth={2} />
                  )}
                  {c.peerOnline && <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] font-extrabold text-ink" style={vipStyle({ isPremium: c.peerIsPremium, textColor: c.peerTextColor })}>{name}</p>
                    <span className={`shrink-0 text-[11px] font-bold ${c.unread ? "text-brand-600" : "text-muted"}`}>{fmtListTime(c.lastAt, locale)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className={`truncate text-[13px] ${c.unread ? "font-bold text-ink/80" : "font-medium text-muted"}`}>
                      {c.lastFromMe && c.lastBody ? (locale === "ar" ? "أنت: " : "You: ") : ""}{preview}
                    </p>
                    {c.unread > 0 && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{ld(c.unread, locale)}</span>
                    )}
                  </div>
                </div>

                {/* while my inbox is closed: let this person in, or shut them out */}
                {dmClosed && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleAllow(c.peerId, !!c.peerAllowed); }}
                    aria-label={c.peerAllowed ? t("dm.revokeOne") : t("dm.allowOne")}
                    title={c.peerAllowed ? t("dm.revokeOne") : t("dm.allowOne")}
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl active:scale-95 ${
                      c.peerAllowed ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-muted"
                    }`}
                  >
                    {c.peerAllowed ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  </button>
                )}
              </Link>
            );
          })}
        </div>

        {/* people to start a new chat with */}
        {q && newPeople.length > 0 && (
          <div className="flex flex-col">
            <p className="px-5 pb-1 pt-4 text-[12px] font-bold text-muted">{t("messages.people")}</p>
            {newPeople.map((p) => {
              const Icon = catIcon(p.category ?? "cat.other");
              return (
                <Link key={p.id} href={`/messages/${p.id}`} className="flex items-center gap-3 px-5 py-3.5 active:bg-slate-50 border-b border-slate-100">
                  <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-50" style={{ height: 48, width: 48 }}>
                    {p.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon className="h-6 w-6 text-brand-600" strokeWidth={2} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-ink">{p.displayName}</p>
                    <p className="text-[12px] font-medium text-muted">{p.category ? t(p.category) : t("messages.startChat")}</p>
                  </div>
                  <UserPlus className="h-5 w-5 shrink-0 text-brand-600" />
                </Link>
              );
            })}
          </div>
        )}

        {!loading && list.length === 0 && newPeople.length === 0 && (
          <p className="py-16 text-center text-[14px] text-muted">{q ? t("messages.noResults") : t("messages.empty")}</p>
        )}
      </div>

      <BottomNav active="messages" />
    </div>
  );
}
