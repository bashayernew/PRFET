/**
 * A tiny registry that lets the global pull-to-refresh gesture ask whatever screen is
 * currently mounted to reload its own data.
 *
 * Why a registry instead of just reloading the page: the app is a WebView pointed at
 * prfet.com, ~130 ms from Frankfurt. A full `location.reload()` re-downloads the document,
 * the bundle and every query, which takes seconds and throws the user back to the top of
 * the feed — the opposite of what pulling down is supposed to feel like. Re-running one
 * screen's fetch is near-instant and keeps scroll position, open sheets and the call bar.
 *
 * Screens opt in with `useRefreshable(loadFn)`. Anything that hasn't opted in still
 * refreshes — `runRefresh()` reports that nobody handled it and the gesture falls back to
 * a real reload, so every page in the app responds to a pull whether it's wired or not.
 */

import { useEffect, useRef } from "react";

type Handler = () => void | Promise<void>;

/**
 * A Set, not a single slot: nested screens can each register (a profile page with an
 * embedded feed, say) and all of them should refetch together.
 */
const handlers = new Set<Handler>();

export function registerRefresh(fn: Handler): () => void {
  handlers.add(fn);
  return () => {
    handlers.delete(fn);
  };
}

/**
 * Run every registered handler. Returns false when there were none, which tells the
 * caller to fall back to a page reload.
 *
 * Handlers are awaited together so the spinner reflects the slowest one rather than
 * disappearing while data is still arriving. A handler that throws must not take the
 * others down — or leave the spinner stuck forever — so each is caught individually.
 */
export async function runRefresh(): Promise<boolean> {
  if (handlers.size === 0) return false;
  await Promise.all(
    [...handlers].map(async (fn) => {
      try {
        await fn();
      } catch (e) {
        // Deliberately swallowed: one screen failing to refetch shouldn't break the
        // gesture. Logged rather than silent, per the house rule about empty catches.
        console.warn("[refresh] handler failed:", e);
      }
    }),
  );
  return true;
}

/**
 * Register a screen's loader for the duration of that screen.
 *
 * `fn` is intentionally NOT in the dependency array. Screen loaders are usually defined
 * inline and get a new identity every render, which would unregister and re-register on
 * each one. A ref keeps the latest version callable while the registration itself stays
 * put for the life of the component.
 */
export function useRefreshable(fn: Handler): void {
  // Keep the ref pointed at the newest closure so the handler never captures stale state.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    return registerRefresh(() => fnRef.current());
  }, []);
}
