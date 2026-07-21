"use client";

import type { ComponentType } from "react";
import {
  Instagram, Youtube, Facebook, Twitter, Send, Ghost, Music2, MessageCircle, Link2,
} from "lucide-react";

type Platform = { icon: ComponentType<{ className?: string; strokeWidth?: number }>; bg: string; fg: string; name: string };

/** Which platform a URL belongs to → its icon + brand colour. Falls back to a generic link. */
function platformOf(url: string): Platform {
  let host = "";
  try { host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* keep generic */ }
  if (host.includes("tiktok")) return { icon: Music2, bg: "#000000", fg: "#ffffff", name: "TikTok" };
  if (host.includes("instagram")) return { icon: Instagram, bg: "#E1306C", fg: "#ffffff", name: "Instagram" };
  if (host.includes("snapchat")) return { icon: Ghost, bg: "#FFFC00", fg: "#1f2937", name: "Snapchat" };
  if (host.includes("twitter") || host === "x.com") return { icon: Twitter, bg: "#000000", fg: "#ffffff", name: "X" };
  if (host.includes("youtube") || host === "youtu.be") return { icon: Youtube, bg: "#FF0000", fg: "#ffffff", name: "YouTube" };
  if (host.includes("whatsapp") || host === "wa.me") return { icon: MessageCircle, bg: "#25D366", fg: "#ffffff", name: "WhatsApp" };
  if (host.includes("telegram") || host === "t.me") return { icon: Send, bg: "#229ED9", fg: "#ffffff", name: "Telegram" };
  if (host.includes("facebook") || host === "fb.com") return { icon: Facebook, bg: "#1877F2", fg: "#ffffff", name: "Facebook" };
  return { icon: Link2, bg: "#6366f1", fg: "#ffffff", name: host || "Link" };
}

/**
 * The premium member's social links, as tappable brand-coloured circles.
 * Renders nothing when there are no links — safe to drop anywhere.
 */
export default function SocialCircles({ links, size = 38 }: { links: (string | null | undefined)[]; size?: number }) {
  const urls = links.filter((l): l is string => !!l && !!l.trim());
  if (urls.length === 0) return null;
  return (
    <div className="flex items-center justify-center gap-3">
      {urls.map((raw, i) => {
        const url = raw.startsWith("http") ? raw : `https://${raw}`;
        const p = platformOf(raw);
        const Icon = p.icon;
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={p.name}
            title={p.name}
            style={{ width: size, height: size, backgroundColor: p.bg, color: p.fg }}
            className="grid shrink-0 place-items-center rounded-full shadow-sm ring-1 ring-white/60 transition-transform active:scale-90"
          >
            <Icon className="h-[55%] w-[55%]" strokeWidth={2.2} />
          </a>
        );
      })}
    </div>
  );
}
