/** Great-circle distance in km between two points. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * How to SHOW a distance: under 1 km we speak in metres, above it in km.
 * Returns the number to display plus the i18n key of its unit.
 */
export function distDisplay(dist: string): { value: string; unit: "home.m" | "home.km" } {
  const km = parseFloat(dist);
  if (!Number.isFinite(km)) return { value: dist, unit: "home.km" };
  if (km < 1) return { value: String(Math.max(1, Math.round(km * 1000))), unit: "home.m" };
  return { value: km >= 10 ? String(Math.round(km)) : km.toFixed(1), unit: "home.km" };
}
