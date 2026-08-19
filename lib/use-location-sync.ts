"use client";

import { useEffect } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { apiPost, getAccessToken } from "@/lib/api";

/**
 * Ask the device for its position once per session and store it.
 * Used only to compute the distance between accounts — coordinates are never
 * shown to anyone unless the account is premium and has "share location" on.
 *
 * Uses @capacitor/geolocation instead of the raw browser API so the SAME code
 * path works everywhere the app runs:
 *  - Website: the plugin transparently falls back to navigator.geolocation.
 *  - Android app: goes through the native permission dialog (requires
 *    ACCESS_COARSE_LOCATION / ACCESS_FINE_LOCATION in AndroidManifest.xml).
 *  - iOS app: goes through the native prompt (requires
 *    NSLocationWhenInUseUsageDescription in Info.plist, once `npx cap add ios`
 *    has been run).
 */
/** Don't ask the device again more often than this. */
const REFRESH_MS = 10 * 60 * 1000; // 10 minutes

/** A fix vaguer than this is useless for "how far away is this shop" — ignore it. */
const MAX_ACCURACY_M = 10000; // 10 km

export function useLocationSync(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const token = getAccessToken();
    if (!token) return;

    // Previously this ran ONCE per browser session and accepted a fix up to 5 minutes
    // stale, so a position captured hours ago (or somewhere else entirely) stuck around
    // for as long as the tab stayed open. Now it refreshes on a timer instead.
    const last = Number(localStorage.getItem("herot.geo.at") || 0);
    if (Date.now() - last < REFRESH_MS) return;

    (async () => {
      try {
        let status = (await Geolocation.checkPermissions()).location;
        if (status !== "granted") {
          status = (await Geolocation.requestPermissions()).location;
        }
        if (status !== "granted") return; // user declined — distance simply stays hidden

        const pos = await Geolocation.getCurrentPosition({
          // GPS on phones. On a laptop there is no GPS, so the browser still falls back
          // to WiFi/IP triangulation — accurate to hundreds of metres at best.
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0, // always a fresh reading, never a cached one
        });

        const acc = pos.coords.accuracy;
        if (typeof acc === "number" && acc > MAX_ACCURACY_M) return; // too vague to be useful

        localStorage.setItem("herot.geo.at", String(Date.now()));
        await apiPost(
          "/api/location",
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          token
        ).catch(() => {});
      } catch {
        /* permission denied, no hardware, or timed out — distance simply stays hidden */
      }
    })();
  }, [active]);
}
