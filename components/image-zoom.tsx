"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Full-screen image lightbox (fix #13). Supports pinch-to-zoom, pan while zoomed, and
 * double-tap to toggle zoom. Tap the backdrop or the X to close. Self-contained — no deps.
 */
export default function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const s = useRef({ startDist: 0, startScale: 1, lastX: 0, lastY: 0, panning: false, lastTap: 0 });

  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches;
    if (t.length === 2) {
      s.current.startDist = dist(t);
      s.current.startScale = scale;
    } else if (t.length === 1) {
      const now = Date.now();
      if (now - s.current.lastTap < 300) {
        if (scale > 1) { setScale(1); setTx(0); setTy(0); } else setScale(2.5);
      }
      s.current.lastTap = now;
      s.current.lastX = t[0].clientX;
      s.current.lastY = t[0].clientY;
      s.current.panning = scale > 1;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches;
    if (t.length === 2 && s.current.startDist > 0) {
      const next = Math.min(5, Math.max(1, s.current.startScale * (dist(t) / s.current.startDist)));
      setScale(next);
      if (next === 1) { setTx(0); setTy(0); }
    } else if (t.length === 1 && s.current.panning) {
      setTx((x) => x + (t[0].clientX - s.current.lastX));
      setTy((y) => y + (t[0].clientY - s.current.lastY));
      s.current.lastX = t[0].clientX;
      s.current.lastY = t[0].clientY;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95"
      style={{ touchAction: "none" }}
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      <button
        onClick={onClose}
        aria-label="close"
        className="absolute right-4 top-[calc(env(safe-area-inset-top)+12px)] z-10 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white active:scale-95"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
        className="max-h-full max-w-full select-none object-contain"
        draggable={false}
      />
    </div>
  );
}
