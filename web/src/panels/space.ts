import type { Panel, Solar, UpdateContext } from "../types.js";

/** Geomagnetic status words, from Kp. */
export function kpStatus(kp: number): { text: string; level: "good" | "fair" | "poor" } {
  if (kp >= 9) return { text: "G5 extreme storm", level: "poor" };
  if (kp >= 8) return { text: "G4 severe storm", level: "poor" };
  if (kp >= 7) return { text: "G3 strong storm", level: "poor" };
  if (kp >= 6) return { text: "G2 moderate storm", level: "poor" };
  if (kp >= 5) return { text: "G1 minor storm", level: "poor" };
  if (kp >= 4) return { text: "Active", level: "fair" };
  if (kp >= 3) return { text: "Unsettled", level: "fair" };
  return { text: "Quiet", level: "good" };
}

const lvl = (v: number | undefined, good: (v: number) => boolean, fair: (v: number) => boolean) =>
  v == null ? "" : good(v) ? "good" : fair(v) ? "fair" : "poor";

/**
 * Space weather, laid out like a geomagnetic dashboard: the key numbers,
 * "currently" and "past 24 hours" status, NOAA's aurora oval forecast for
 * your hemisphere, and the last 24 hours of 3-hour Kp.
 */
export class SpaceWeather implements Panel {
  el: HTMLElement;
  private lastKey = "";

  constructor() {
    this.el = document.createElement("section");
    this.el.className = "panel space";
  }

  update(ctx: UpdateContext): void {
    const s = ctx.solar;
    const key = JSON.stringify(s ?? null);
    if (key === this.lastKey) return; // only redraw when the data changed
    this.lastKey = key;
    if (!s || !s.updated) {
      this.el.innerHTML = `<h2>Space weather</h2><div class="muted hint">Waiting for NOAA space weather data…</div>`;
      return;
    }
    const f = (v: number | undefined, d = 0) => (v == null ? "—" : v.toFixed(d));
    const stat = (label: string, value: string, level: string, title: string) =>
      `<div class="sw-stat ${level}" title="${title}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
    const now = s.kp != null ? kpStatus(s.kp) : undefined;
    const past = s.kpMax24 != null ? kpStatus(s.kpMax24) : undefined;
    const xLevel = !s.xray ? "" : /^[XM]/.test(s.xray) ? "poor" : /^C/.test(s.xray) ? "fair" : "good";

    this.el.innerHTML = `
      <h2>Space weather</h2>
      <div class="sw-stats">
        ${stat("SFI", f(s.sfi), lvl(s.sfi, (v) => v >= 150, (v) => v >= 90), "10.7 cm solar flux: higher means better HF above 20 m")}
        ${stat("Kp", f(s.kp, 2), lvl(s.kp, (v) => v < 3, (v) => v < 5), "Planetary K index (estimated, latest)")}
        ${stat("A", f(s.a), lvl(s.a, (v) => v < 20, (v) => v < 30), "Estimated planetary A index for today (UTC)")}
        ${stat("X-ray", s.xray ?? "—", xLevel, "GOES X-ray class: M/X flares can black out sunlit HF paths")}
        ${stat("N HPI", s.hpiN != null ? `${f(s.hpiN)}<small>GW</small>` : "—", lvl(s.hpiN, (v) => v < 25, (v) => v < 60), "Northern hemispheric power: auroral energy input")}
        ${stat("S HPI", s.hpiS != null ? `${f(s.hpiS)}<small>GW</small>` : "—", lvl(s.hpiS, (v) => v < 25, (v) => v < 60), "Southern hemispheric power")}
      </div>
      <div class="sw-status">
        ${now ? `<div class="pill ${now.level}"><i></i>Currently: ${now.text}</div>` : ""}
        ${past ? `<div class="pill ${past.level}"><i></i>Past 24 hours: ${past.text}</div>` : ""}
      </div>
      <div class="sw-charts">
        <figure class="sw-aurora">
          ${s.aurora ? `<img src="api/aurora.jpg?t=${s.aurora}" alt="NOAA aurora oval forecast">` : `<div class="muted hint">Aurora forecast loading…</div>`}
          <figcaption>Auroral oval forecast</figcaption>
        </figure>
        <figure class="sw-kp">
          ${kpChart(s)}
          <figcaption>Kp, last 24 h</figcaption>
        </figure>
      </div>`;
  }
}

/** The last 24 h of 3-hour Kp as an SVG bar chart, like SWPC's. */
function kpChart(s: Solar): string {
  const pts = (s.kp24 ?? []).slice(-8);
  if (!pts.length) return `<div class="muted hint">No Kp data yet</div>`;
  const W = 320, H = 200, L = 18, B = 18, T = 6, R = 4;
  const cw = (W - L - R) / pts.length;
  const y = (kp: number) => T + (H - T - B) * (1 - kp / 9);
  const color = (kp: number) => (kp >= 5 ? "var(--poor)" : kp >= 4 ? "var(--fair)" : "var(--good)");
  const grid = [0, 3, 6, 9].map((v) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join("");
  const bars = pts.map((p, i) => {
    const h = Math.max(1.5, y(0) - y(p.kp));
    return `<rect x="${L + i * cw + cw * 0.15}" y="${y(0) - h}" width="${cw * 0.7}" height="${h}" rx="1.5" fill="${color(p.kp)}"><title>${new Date(p.t).toISOString().slice(11, 16)}Z  Kp ${p.kp.toFixed(2)}</title></rect>`;
  }).join("");
  const labels = pts.map((p, i) => (i % 2 === 0
    ? `<text x="${L + i * cw + cw / 2}" y="${H - 4}" text-anchor="middle">${new Date(p.t).toISOString().slice(11, 13)}Z</text>` : "")).join("");
  // Dashed line at the storm threshold (Kp 5) and at UTC midnight.
  const storm = `<line x1="${L}" x2="${W - R}" y1="${y(5)}" y2="${y(5)}" class="storm"/>`;
  const mid = pts.findIndex((p) => new Date(p.t).getUTCHours() === 0);
  const midnight = mid > 0 ? `<line x1="${L + mid * cw}" x2="${L + mid * cw}" y1="${T}" y2="${y(0)}" class="mid"/>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${storm}${midnight}${bars}${labels}</svg>`;
}
