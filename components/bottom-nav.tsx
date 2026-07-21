"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Home, Headset, MessageCircle, Plus, User } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet, getAccessToken } from "@/lib/api";
import { getSocket } from "@/lib/socket";

export type Tab = "home" | "contact" | "discover" | "messages" | "create" | "profile";

const TABS: { key: Tab; href: string; icon: typeof Home; labelKey: string }[] = [
  { key: "home", href: "/home", icon: Home, labelKey: "nav.home" },
  { key: "contact", href: "/contact", icon: Headset, labelKey: "nav.contact" },
  { key: "create", href: "/create", icon: Plus, labelKey: "nav.create" },
  { key: "messages", href: "/messages", icon: MessageCircle, labelKey: "nav.messages" },
  { key: "profile", href: "/profile", icon: User, labelKey: "nav.profile" },
];

export default function BottomNav({ active }: { active: Tab }) {
  const router = useRouter();
  const { t, dir } = useI18n();
  const [unread, setUnread] = useState(0);

  // Unread messages badge — refreshed on load and live whenever one arrives.
  const refresh = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    const res = await apiGet<{ conversations: { unread: number }[] }>("/api/conversations", token);
    if (res.ok && res.data?.conversations) {
      setUnread(res.data.conversations.reduce((n, c) => n + (c.unread || 0), 0));
    }
  }, []);

  useEffect(() => {
    if (active === "messages") { setUnread(0); return; }
    refresh();
    const token = getAccessToken();
    if (!token) return;
    let sock: { on: (e: string, cb: (p: unknown) => void) => void; off: (e: string) => void } | null = null;
    let alive = true;
    (async () => {
      const s = await getSocket(token);
      if (!alive) return;
      sock = s;
      s.on("message:new", () => setUnread((n) => n + 1));
    })();
    return () => { alive = false; sock?.off("message:new"); };
  }, [active, refresh]);

  return (
    <nav
      dir={dir}
      className="shrink-0 border-t border-slate-100 bg-white px-2 pb-[calc(env(safe-area-inset-bottom)+6px)] pt-2"
    >
      <div className="flex items-stretch justify-between">
        {TABS.map(({ key, href, icon: Icon, labelKey }) => {
          const on = key === active;
          const isCreate = key === "create";
          return (
            <button
              key={key}
              onClick={() => router.push(href)}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5"
            >
              <span
                className={`relative grid h-8 w-12 place-items-center rounded-full transition-colors ${
                  isCreate ? "bg-brand-600" : on ? "bg-brand-50" : ""
                }`}
              >
                <Icon
                  className={`h-[22px] w-[22px] ${isCreate ? "text-white" : on ? "text-brand-600" : "text-muted"}`}
                  strokeWidth={isCreate ? 2.8 : on ? 2.5 : 2}
                />
                {key === "messages" && unread > 0 && (
                  <span className="absolute end-1.5 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
              <span className={`text-[10.5px] font-bold ${on ? "text-brand-600" : "text-muted"}`}>
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
