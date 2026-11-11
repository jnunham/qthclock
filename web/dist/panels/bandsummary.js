import { BANDS, bandColor, modeGroup } from "../bands.js";
import { km } from "../astro.js";
/**
 * Per-band summary of one side of your signal path:
 *   "me"   -> My signal: how many stations hear you, the average report you're
 *             getting, and the farthest station
 *   "here" -> Heard here: what your own receiver is decoding
 *
 * The average uses each station's latest report only, so one station spotting
 * you 20 times doesn't swamp it. Reports are averaged per mode, because an FT8
 * SNR and an RBN CW SNR aren't measured the same way.
 */
export class BandSummary {
    rel;
    emptyHint;
    el;
    body;
    rows = new Map();
    select;
    constructor(rel, title, emptyHint) {
        this.rel = rel;
        this.emptyHint = emptyHint;
        this.el = document.createElement("section");
        this.el.className = `panel summary ${rel}`;
        this.el.innerHTML = `
      <h2>${title} <span class="muted count"></span></h2>
      <div class="srow head muted"><span>Band</span><span>Stations</span><span class="n">Avg report</span><span>Farthest</span></div>
      <div class="rows"></div>`;
        this.body = this.el.querySelector(".rows");
        this.body.addEventListener("click", (e) => {
            const row = e.target.closest("[data-band]");
            const s = row && this.rows.get(row.dataset.band);
            if (s)
                this.select?.(s);
        });
    }
    update(ctx) {
        // Latest spot per (band, other station), so averages count each station once.
        const latest = new Map();
        for (const s of ctx.spots) {
            if (s.rel !== this.rel)
                continue;
            const key = s.b + "|" + (this.rel === "me" ? s.de : s.dx);
            if (!latest.has(key))
                latest.set(key, s); // spots arrive newest first
        }
        const per = new Map();
        for (const s of latest.values()) {
            const b = per.get(s.b) ?? { n: 0, snr: new Map() };
            b.n++;
            if (s.km != null && (b.far?.km == null || s.km > b.far.km))
                b.far = s;
            if (s.snr != null) {
                const g = modeGroup(s.m);
                b.snr.set(g, [...(b.snr.get(g) ?? []), s.snr]);
            }
            per.set(s.b, b);
        }
        const stations = new Set([...latest.values()].map((s) => (this.rel === "me" ? s.de : s.dx)));
        this.el.querySelector(".count").textContent = stations.size ? `${stations.size} stations` : "";
        this.select = (s) => {
            const lat = this.rel === "me" ? s.dela : s.dxla;
            const lon = this.rel === "me" ? s.delo : s.dxlo;
            if (lat != null && lon != null) {
                ctx.select({ call: this.rel === "me" ? s.de : s.dx, lat, lon, grid: this.rel === "me" ? s.deg : s.dxg, spot: s });
            }
        };
        if (!per.size) {
            this.body.innerHTML = `<div class="muted hint">${this.emptyHint}</div>`;
            return;
        }
        const max = Math.max(...[...per.values()].map((b) => b.n));
        this.rows.clear();
        this.body.innerHTML = BANDS.filter((b) => per.has(b)).map((band) => {
            const b = per.get(band);
            if (b.far)
                this.rows.set(band, b.far);
            const farCall = b.far ? (this.rel === "me" ? b.far.de : b.far.dx) : "";
            // Most-reported mode first; show at most two.
            const avgs = [...b.snr.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 2)
                .map(([mode, list]) => {
                const avg = Math.round(list.reduce((a, v) => a + v, 0) / list.length);
                const label = b.snr.size > 1 || mode !== "FT8" ? ` <span class="muted">${mode}</span>` : "";
                return `<span class="snr ${level(mode, avg)}" title="${list.length} report${list.length > 1 ? "s" : ""}, ${Math.min(...list)} to ${Math.max(...list)} dB">${avg > 0 ? "+" : ""}${avg}${label}</span>`;
            }).join(" ");
            const cur = ctx.working?.b === band ? " cur" : "";
            return `<div class="srow${cur}" data-band="${band}" title="Click to show the farthest station as DX">
        <span class="chip" style="--c:${bandColor(band)}">${band}</span>
        <span class="track"><span class="fill" style="width:${(b.n / max) * 100}%;background:${bandColor(band)}"></span></span>
        <span class="n">${b.n}</span>
        <span class="n avg">${avgs || '<span class="muted">—</span>'}</span>
        <span class="far">${farCall ? `<b>${farCall}</b> <span class="muted">${km(b.far.km)}</span>` : ""}</span>
      </div>`;
        }).join("");
    }
}
/** Rough "how good is this report" by mode: FT8/FT4 SNR vs RBN CW/RTTY SNR. */
function level(mode, db) {
    const [good, fair] = mode === "CW" || mode === "RTTY" ? [20, 10] : mode === "SSB" ? [0, -99] : [-10, -18];
    return db >= good ? "good" : db >= fair ? "fair" : "poor";
}
//# sourceMappingURL=bandsummary.js.map