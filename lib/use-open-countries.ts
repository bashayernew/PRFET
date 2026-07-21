"use client";

import { useEffect, useState } from "react";
import { COUNTRIES, type Country } from "@/lib/countries";

// Fetched once per app load and shared by every picker.
let cache: Set<string> | null = null;
let inflight: Promise<Set<string>> | null = null;

async function fetchClosed(): Promise<Set<string>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        cache = new Set(
          ((d?.settings?.closedCountries as string) ?? "")
            .split(",")
            .map((c: string) => c.trim().toUpperCase())
            .filter(Boolean)
        );
        return cache;
      })
      .catch(() => new Set<string>());
  }
  return inflight;
}

/** Call after the admin flips a country so pickers refresh on next mount. */
export function invalidateOpenCountries() {
  cache = null;
  inflight = null;
}

/**
 * The world minus whatever the admin has closed. Starts with the full list
 * (no flash of empty), then narrows once the closed set arrives.
 */
export function useOpenCountries(): { countries: Country[]; closed: Set<string> } {
  const [closed, setClosed] = useState<Set<string>>(cache ?? new Set());

  useEffect(() => {
    let alive = true;
    fetchClosed().then((s) => { if (alive) setClosed(s); });
    return () => { alive = false; };
  }, []);

  return {
    countries: closed.size ? COUNTRIES.filter((c) => !closed.has(c.code)) : COUNTRIES,
    closed,
  };
}
