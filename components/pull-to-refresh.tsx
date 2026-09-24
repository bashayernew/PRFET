"use client";

/**
 * Instagram/Snapchat-style pull to refresh, for every page in the app.
 *
 * Mounted once in the root layout, so it covers every route including ones nobody has
 * wired up explicitly. Works identically in a desktop browser and inside the Android
 * WebView, which matters because the Capacitor shell just loads prfet.com — this ships
 * with a normal web deploy, no new AAB.
 *
 * ── Why it's written this way ───────────────────────────────────────────────────────
 * The gesture only begins when the *scrolling element under the finger* is already at
 * the top. Walking up from the touch target instead of reading `window.scrollY` is what
 * keeps the pull from stealing scrolls inside the chat list, the comments sheet, the
 * story viewer or the country picker — each of those is its own scroll container sitting
 * inside a page that is itself at scroll 0.
 *
 * Listeners are passive until the pull is real. A non-passive `touchmove` that calls
 * preventDefault() on every scroll makes the whole app feel sticky in a WebView, so the
 * move listener is registered passively and the rubber-band is driven purely by
 * transform, never by blocking the browser's own scrolling.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { runRefresh } from "@/lib/refresh";

/** Finger travel needed to commit to a refresh. */
const THRESHOLD = 72;
/** Hard cap on how far the indicator travels, so a long drag doesn't fling it down the page. */
const MAX_PULL = 120;
/** Below this the drag is treated as an accidental twitch, not a pull. */
const START_SLOP = 8;

/** Nearest ancestor that actually scrolls, so nested lists keep their own scrolling. */
function scrollableAncestor(start: EventTarget | null): Element | null {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const scrolls = /(auto|scroll|overlay)/.test(style.overflowY);
    if (scrolls && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return null;
}

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);

  const startY = useRef(0);
  const active = useRef(false);
  const busyRef = useRef(false);
  // touchend runs from a closure created at mount, so it can't read `pull` state
  // directly — this ref carries the live value across to it.
  const pullRef = useRef(0);
  pullRef.current = pull;

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (busyRef.current || e.touches.length !== 1) return;

      // A modal, the call overlay, a story or a fullscreen viewer owns the whole screen;
      // pulling inside one should never refresh the page behind it.
      const target = e.target as Element | null;
      if (target?.closest("[data-no-pull-refresh]")) return;

      // Only start at the very top of whatever is scrolling under the finger.
      const scroller = scrollableAncestor(target);
      const atTop = scroller ? scroller.scrollTop <= 0 : window.scrollY <= 0;
      if (!atTop) return;

      startY.current = e.touches[0].clientY;
      active.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!active.current || busyRef.current) return;
      const dy = e.touches[0].clientY - startY.current;

      // Upward move means they're scrolling, not pulling — abandon the gesture.
      if (dy < 0) {
        active.current = false;
        setPull(0);
        return;
      }
      if (dy < START_SLOP) return;

      // Resistance curve: the further you pull the less it moves, which is what makes
      // the gesture feel elastic rather than linear.
      const eased = Math.min(MAX_PULL, (dy - START_SLOP) * 0.5);
      setPull(eased);
    }

    async function onTouchEnd() {
      if (!active.current) return;
      active.current = false;

      const shouldRefresh = pullRef.current >= THRESHOLD;
      if (!shouldRefresh) {
        setPull(0);
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setPull(THRESHOLD);

      try {
        const handled = await runRefresh();
        // Nothing on this screen knows how to refetch, so do the honest thing and
        // reload. Every page responds to a pull, wired or not.
        if (!handled) {
          window.location.reload();
          return;
        }
        // A refresh that finishes in 20ms reads as "nothing happened". A short floor
        // makes it legible without being slow.
        await new Promise((r) => setTimeout(r, 350));
      } finally {
        busyRef.current = false;
        setBusy(false);
        setPull(0);
      }
    }

    // Passive listeners: we never call preventDefault, so the browser keeps its own
    // scrolling smooth and the WebView doesn't feel laggy.
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const visible = pull > 0 || busy;
  const progress = Math.min(1, pull / THRESHOLD);
  const ready = progress >= 1;

  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center"
      style={{
        transform: `translateY(${visible ? Math.max(pull, busy ? THRESHOLD : 0) - 44 : -60}px)`,
        transition: pull === 0 || busy ? "transform 220ms cubic-bezier(.22,1,.36,1)" : "none",
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="mt-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 shadow-lg shadow-black/40">
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-white" />
        ) : (
          <ArrowDown
            className="h-5 w-5 text-white transition-transform duration-200"
            style={{ transform: `rotate(${ready ? 180 : 0}deg)`, opacity: 0.4 + progress * 0.6 }}
          />
        )}
      </div>
    </div>
  );
}
