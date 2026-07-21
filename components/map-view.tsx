"use client";

import { useEffect, useRef } from "react";
import { Navigation } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

type Leaflet = {
  map: (el: HTMLElement, opts?: Record<string, unknown>) => LMap;
  tileLayer: (url: string, opts?: Record<string, unknown>) => { addTo: (m: LMap) => void };
  circleMarker: (pos: [number, number], opts?: Record<string, unknown>) => { addTo: (m: LMap) => unknown };
};
type LMap = { setView: (pos: [number, number], zoom: number) => LMap; remove: () => void };

let loading: Promise<Leaflet> | null = null;

/** Load Leaflet from the CDN once — no package, no API key, no billing account. */
function loadLeaflet(): Promise<Leaflet> {
  if (loading) return loading;
  loading = new Promise<Leaflet>((resolve, reject) => {
    const w = window as unknown as { L?: Leaflet };
    if (w.L) return resolve(w.L);

    if (!document.querySelector(`link[href="${CSS_URL}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS_URL;
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = JS_URL;
    script.async = true;
    script.onload = () => {
      const g = window as unknown as { L?: Leaflet };
      g.L ? resolve(g.L) : reject(new Error("leaflet missing"));
    };
    script.onerror = () => reject(new Error("leaflet failed"));
    document.head.appendChild(script);
  });
  return loading;
}

/** The person's precise location on a real map — pan and zoom, like Google Maps. */
export default function MapView({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);

  useEffect(() => {
    let dead = false;
    loadLeaflet()
      .then((L) => {
        if (dead || !boxRef.current || mapRef.current) return;
        const map = L.map(boxRef.current, {
          scrollWheelZoom: false,
          zoomControl: false,
          attributionControl: false,
        }).setView([lat, lng], 15);

        // a clean, light basemap — free, no key
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
          maxZoom: 19,
          subdomains: "abcd",
        }).addTo(map);

        // a soft brand-coloured dot instead of the default pin
        L.circleMarker([lat, lng], {
          radius: 9,
          color: "#ffffff",
          weight: 3,
          fillColor: "#282e9e",
          fillOpacity: 1,
        }).addTo(map);
        L.circleMarker([lat, lng], {
          radius: 26,
          stroke: false,
          fillColor: "#282e9e",
          fillOpacity: 0.14,
        }).addTo(map);

        mapRef.current = map;
      })
      .catch(() => { /* offline — the "open in maps" button below still works */ });

    return () => {
      dead = true;
      try { mapRef.current?.remove(); } catch { /* already gone */ }
      mapRef.current = null;
    };
  }, [lat, lng, name]);

  return (
    <div className="relative overflow-hidden rounded-2xl ring-1 ring-slate-200">
      <div ref={boxRef} className="h-36 w-full bg-slate-100" />

      {/* directions — a small pill floating on the map */}
      <a
        href={`https://www.google.com/maps?q=${lat},${lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 end-2 z-[500] flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-bold text-brand-700 shadow-md backdrop-blur active:scale-95"
      >
        <Navigation className="h-3.5 w-3.5" /> {t("map.directions")}
      </a>

      <span className="absolute bottom-1 start-2 z-[500] text-[9px] font-medium text-slate-500/80">© OpenStreetMap</span>
    </div>
  );
}
