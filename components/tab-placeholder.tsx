"use client";

import { Compass, Headset, MessageCircle, Plus, User } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import BottomNav, { type Tab } from "@/components/bottom-nav";
import { useRequireAuth } from "@/lib/use-auth";

const ICONS = {
  discover: Compass,
  contact: Headset,
  messages: MessageCircle,
  create: Plus,
  profile: User,
} as const;

export default function TabPlaceholder({ tab }: { tab: Exclude<Tab, "home"> }) {
  const { t, dir } = useI18n();
  const ready = useRequireAuth();
  const Icon = ICONS[tab];

  if (!ready) return null;

  return (
    <div dir={dir} className="mx-auto flex h-[100dvh] max-w-[480px] flex-col bg-slate-50">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-50">
          <Icon className="h-10 w-10 text-brand-600" strokeWidth={2} />
        </div>
        <h1 className="text-xl font-extrabold text-ink">{t(`soon.${tab}`)}</h1>
        <p className="max-w-[280px] text-[14px] leading-relaxed text-muted">{t("soon.body")}</p>
      </div>
      <BottomNav active={tab} />
    </div>
  );
}
