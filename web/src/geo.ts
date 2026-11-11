const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Points along the great circle between two positions, as [lon, lat]. */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number, n = 32): [number, number][] {
  const p1 = toVec(lat1, lon1);
  const p2 = toVec(lat2, lon2);
  const dot = Math.min(1, Math.max(-1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return [[lon1, lat1], [lon2, lat2]];
  const out: [number, number][] = [];
  let prevLon = lon1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.sin((1 - t) * omega) / Math.sin(omega);
    const b = Math.sin(t * omega) / Math.sin(omega);
    const x = a * p1[0] + b * p2[0];
    const y = a * p1[1] + b * p2[1];
    const z = a * p1[2] + b * p2[2];
    const lat = Math.atan2(z, Math.hypot(x, y)) * DEG;
    let lon = Math.atan2(y, x) * DEG;
    // Unwrap so the line doesn't jump across the whole map at the antimeridian.
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    out.push([lon, lat]);
  }
  return out;
}

function toVec(lat: number, lon: number): [number, number, number] {
  const la = lat * RAD, lo = lon * RAD;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** Sub-solar point (low-precision almanac, fine for a gray line). */
export function sunPosition(date: Date): { lat: number; lon: number } {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * DEG;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) * DEG;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  let lon = ra - gmst * 15;
  lon = ((lon + 540) % 360) - 180;
  return { lat: dec, lon };
}

/** Polygon covering the night side of the Earth, as [lon, lat] ring. */
export function nightPolygon(date: Date, maxLat = 85): [number, number][] {
  const sun = sunPosition(date);
  const dec = sun.lat === 0 ? 0.0001 : sun.lat;
  const ring: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const ha = (lon - sun.lon) * RAD;
    let lat = Math.atan(-Math.cos(ha) / Math.tan(dec * RAD)) * DEG;
    lat = Math.max(-maxLat, Math.min(maxLat, lat));
    ring.push([lon, lat]);
  }
  const pole = dec > 0 ? -maxLat : maxLat; // night surrounds the pole facing away from the sun
  ring.push([180, pole], [-180, pole], ring[0]);
  return ring;
}

/**
 * Night/twilight shading as a 360×180 image (1° per pixel, equirectangular,
 * top-left = 180°W 90°N): transparent in daylight, darkening smoothly
 * through civil and nautical twilight to full night at the sun 12° below the
 * horizon. Scale it onto the map with smoothing for a soft gray line.
 */
export function nightImage(date: Date, maxAlpha: number, rgb: [number, number, number] = [0, 0, 0]): HTMLCanvasElement {
  const sun = sunPosition(date);
  const sd = Math.sin(sun.lat * RAD), cd = Math.cos(sun.lat * RAD);
  const cv = document.createElement("canvas");
  cv.width = 360;
  cv.height = 180;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(360, 180);
  for (let j = 0; j < 180; j++) {
    const lat = (89.5 - j) * RAD;
    const sl = Math.sin(lat), cl = Math.cos(lat);
    for (let i = 0; i < 360; i++) {
      const H = (-179.5 + i - sun.lon) * RAD;
      const elev = Math.asin(sl * sd + cl * cd * Math.cos(H)) * DEG;
      // 0 at sunset, 1 at -12°, smooth in between.
      const t = Math.min(1, Math.max(0, -elev / 12));
      const a = t * t * (3 - 2 * t) * maxAlpha;
      const k = (j * 360 + i) * 4;
      img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2];
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
