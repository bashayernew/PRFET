"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, getAccessToken } from "@/lib/api";
import { catIcon } from "@/lib/cat-icons";

type Person = { id: string; displayName: string; avatarUrl: string | null; category: string | null };

export default function FollowsScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  // ?user=<id> — someone else's followers / following. No param = mine.
  const userId = search.get("user");
  const [tab, setTab] = useState<"followers" | "following">(search.get("tab") === "following" ? "following" : "followers");
  const [followers, setFollowers] = useState<Person[] | null>(null);
  const [following, setFollowing] = useState<Person[] | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;

    if (userId) {
      apiGet<{ followers: Person[]; following: Person[] }>(`/api/users/${userId}/follows`, token).then((res) => {
        setFollowers(res.ok && res.data?.followers ? res.data.followers : []);
        setFollowing(res.ok && res.data?.following ? res.data.following : []);
      });
      apiGet<{ user: { displayName: string } }>(`/api/users/${userId}`, token).then((res) => {
        if (res.ok && res.data?.user) setName(res.data.user.displayName);
      });
      return;
    }

    apiGet<{ targets: Person[] }>("/api/follows?followers=1", token).then((res) => {
      if (res.ok && res.data?.targets) setFollowers(res.data.targets);
      else setFollowers([]);
    });
    apiGet<{ targets: Person[] }>("/api/follows?full=1", token).then((res) => {
      if (res.ok && res.data?.targets) setFollowing(res.data.targets);
      else setFollowing([]);
    });
  }, [ready, userId]);

  if (!ready) return null;
  const list = tab === "followers" ? followers : following;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      {/* header */}
      <div className="flex items-center gap-3 bg-gradient-to-b from-brand-700 to-brand-600 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+14px)]">
        <button onClick={() => router.push(userId ? `/business/${userId}` : "/profile")} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95">
          <Back className="h-5 w-5" />
        </button>
        <p className="truncate text-[15px] font-extrabold text-white">{name ?? t("follows.title")}</p>
      </div>

      {/* tabs */}
      <div className="flex gap-1.5 bg-white p-2 shadow-sm">
        {(["followers", "following"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold transition-all ${tab === k ? "bg-brand-50 text-brand-700" : "text-muted"}`}>
            {t(k === "followers" ? "profile.followers" : "profile.following")}
            {(k === "followers" ? followers : following) !== null && ` (${(k === "followers" ? followers! : following!).length})`}
          </button>
        ))}
      </div>

      {/* list */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
        {list === null ? null : list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-16 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-3xl bg-brand-50 text-brand-400"><Users className="h-7 w-7" /></span>
            <p className="text-[13.5px] font-bold text-muted">{t("follows.none")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
            {list.map((p, i) => {
              const Icon = catIcon(p.category ?? "cat.other");
              return (
                <button key={p.id} onClick={() => router.push(`/business/${p.id}`)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-start active:bg-slate-50 ${i === list.length - 1 ? "" : "border-b border-slate-100"}`}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50">
                    {p.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : p.category ? (
                      <Icon className="h-5 w-5 text-brand-600" />
                    ) : (
                      <span className="text-[15px] font-extrabold text-brand-600">{(p.displayName || "•").charAt(0).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{p.displayName}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
