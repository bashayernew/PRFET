"use client";

import { useEffect } from "react";
import { apiPost, getAccessToken } from "@/lib/api";

/**
 * Ask the device for its position once per session and store it.
 * Used only to compute the distance between accounts — coordinates are never
 * shown to anyone unless the account is premium and has "share location" on.
 */
export function useLocationSync(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const token = getAccessToken();
    if (!token) return;
    if (sessionStorage.getItem("herot.geo") === "1") return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        sessionStorage.setItem("herot.geo", "1");
        apiPost("/api/location", { lat: pos.coords.latitude, lng: pos.coords.longitude }, token).catch(() => {});
      },
      () => { /* permission denied — distance simply stays hidden */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }, [active]);
}
