// Sun times, bearings and distances for the DE/DX panel.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function sunParams(date: Date): { dec: number; eotMin: number } {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = (Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * DEG + 360) % 360;
  let diff = q - ra;
  diff = ((diff + 540) % 360) - 180;
  return { dec: Math.asin(Math.sin(e) * Math.sin(L)) * DEG, eotMin: 4 * diff };
}

export type SunTimes =
  | { kind: "normal"; rise: Date; set: Date }
  | { kind: "day" | "night" };

/** Sunrise and sunset (UTC) on the UTC day containing `date`. */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const noonGuess = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const { dec, eotMin } = sunParams(noonGuess);
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(dec * RAD)) / (Math.cos(lat * RAD) * Math.cos(dec * RAD));
  if (cosH > 1) return { kind: "night" };
  if (cosH < -1) return { kind: "day" };
  const H = Math.acos(cosH) * DEG;
  const noonMin = 720 - 4 * lon - eotMin;
  const day0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { kind: "normal", rise: new Date(day0 + (noonMin - 4 * H) * 60000), set: new Date(day0 + (noonMin + 4 * H) * 60000) };
}

/** Initial great-circle bearing from point 1 to point 2, degrees 0-360. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function toGrid(lat: number, lon: number): string {
  const x = lon + 180, y = lat + 90;
  const A = "ABCDEFGHIJKLMNOPQR", a = "abcdefghijklmnopqrstuvwx";
  return A[Math.floor(x / 20)] + A[Math.floor(y / 10)] +
    Math.floor((x % 20) / 2) + Math.floor(y % 10) +
    a[Math.floor(((x % 2) * 60) / 5)] + a[Math.floor(((y % 1) * 60) / 2.5)];
}

export const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/** Local time at a longitude, approximated from solar zones (no political time zones). */
export function approxLocal(now: number, lon: number): { time: string; offset: number } {
  const offset = Math.round(lon / 15);
  return { time: hhmm(new Date(now + offset * 3600000)), offset };
}

/** Distances are stored in km and shown in the unit chosen in Settings (miles by default). */
let unit: "mi" | "km" = "mi";
export function setUnits(u: "mi" | "km") { unit = u; }
export const km = (n: number) =>
  unit === "mi" ? `${Math.round(n * 0.621371).toLocaleString()} mi` : `${Math.round(n).toLocaleString()} km`;
