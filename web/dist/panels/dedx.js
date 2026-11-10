import { approxLocal, bearing, distanceKm, hhmm, km, sunTimes, toGrid } from "../astro.js";
/**
 * HamClock's DE and DX boxes: where I am, where the selected station is, and
 * the path between us. Click any station on the map or in a list to set DX.
 */
export class DeDx {
    cfg;
    el;
    constructor(cfg) {
        this.cfg = cfg;
        this.el = document.createElement("section");
        this.el.className = "panel dedx";
    }
    update(ctx) {
        const cfg = this.cfg;
        const now = new Date(ctx.now);
        const de = cfg.lat != null && cfg.lon != null ? { lat: cfg.lat, lon: cfg.lon } : undefined;
        const sunLine = (lat, lon) => {
            const t = sunTimes(now, lat, lon);
            if (t.kind === "normal")
                return `☀ ${hhmm(t.rise)} – ${hhmm(t.set)}Z`;
            return t.kind === "day" ? "Sun up all day" : "Sun down all day";
        };
        const deHtml = de
            ? `<div class="kv"><span>${cfg.grid}</span><span class="muted">${sunLine(de.lat, de.lon)}</span></div>`
            : `<div class="muted">Set "grid" in config.json</div>`;
        let dxHtml = `<div class="muted hint">Click a station on the map or in a list</div>`;
        const dx = ctx.dx;
        if (dx) {
            const loc = approxLocal(ctx.now, dx.lon);
            let path = "";
            if (de) {
                const sp = bearing(de.lat, de.lon, dx.lat, dx.lon);
                const d = distanceKm(de.lat, de.lon, dx.lat, dx.lon);
                path = `
          <div class="path">
            <div><span class="muted">SP</span> <b>${Math.round(sp)}°</b> ${km(d)}</div>
            <div><span class="muted">LP</span> <b>${Math.round((sp + 180) % 360)}°</b> ${km(40030 - d)}</div>
          </div>`;
            }
            const s = dx.spot;
            const heard = s ? `<div class="muted small">${s.f.toFixed(1)} kHz ${s.m}${s.snr != null ? ` · ${s.snr} dB` : ""} · ${relText(s.rel)}</div>` : "";
            dxHtml = `
        <div class="kv"><span>${dx.grid || toGrid(dx.lat, dx.lon).slice(0, 4)}</span><span class="muted">${sunLine(dx.lat, dx.lon)}</span></div>
        <div class="kv"><span>~${loc.time} local</span><span class="muted">UTC${loc.offset >= 0 ? "+" : ""}${loc.offset}</span></div>
        ${path}${heard}`;
        }
        this.el.innerHTML = `
      <div class="col">
        <h2>DE</h2>
        <div class="big">${cfg.callsign || "NOCALL"}</div>
        ${deHtml}
      </div>
      <div class="col">
        <h2>DX ${dx ? '<button class="clear" title="Clear">✕</button>' : ""}</h2>
        <div class="big">${dx ? dx.call : "—"}</div>
        ${dxHtml}
      </div>`;
        this.el.querySelector(".clear")?.addEventListener("click", () => ctx.select(undefined));
    }
}
function relText(rel) {
    return rel === "me" ? "heard you" : rel === "here" ? "you heard them" : "spotted near you";
}
//# sourceMappingURL=dedx.js.map