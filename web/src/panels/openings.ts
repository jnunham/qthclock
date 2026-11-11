import type { Panel, ServerConfig, Spot, UpdateContext } from "../types.js";
import { bandColor } from "../bands.js";

const CONTINENTS = ["NA", "SA", "EU", "AF", "AS", "OC"] as const;
const BANDS = ["160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"];
const WINDOW_MS = 15 * 60_000;
const REFRESH_MS = 60_000;

/**
 * "Bands open from here": for each band, which continents skimmers and
 * cluster spotters near your QTH have heard in the last 15 minutes. A calm
 * propagation summary instead of a scrolling DX list; it refreshes once a
 * minute and never flashes.
 */
export class Openings implements Panel {
  el: HTMLElement;
  private body: HTMLElement;
  private last = 0;

  constructor(private cfg: ServerConfig) {
    this.el = document.createElement("section");
    this.el.className = "panel openings";
    this.el.innerHTML = `
      <h2>Bands open from here <span class="muted">heard near you · 15 min</span></h2>
      <div class="orows"></div>`;
    this.body = this.el.querySelector(".orows")!;
  }

  update(ctx: UpdateContext): void {
    if (ctx.now - this.last < REFRESH_MS && this.last) return;
    this.last = ctx.now;

    // band -> continent -> set of DX calls
    const heard = new Map<string, Map<string, Set<string>>>();
    for (const s of ctx.spots as Spot[]) {
      if (s.rel !== "near" || ctx.now - s.t > WINDOW_MS || !s.dxk || !s.b) continue;
      if (this.cfg.country && s.dxc === this.cfg.country) continue; // your own country tells you nothing
      const byCont = heard.get(s.b) ?? new Map<string, Set<string>>();
      const calls = byCont.get(s.dxk) ?? new Set<string>();
      calls.add(s.dx);
      byCont.set(s.dxk, calls);
      heard.set(s.b, byCont);
    }

    if (!heard.size) {
      this.body.innerHTML = `<div class="muted hint">Nothing heard near you in the last 15 minutes. This fills in from RBN skimmers within ${Math.round(this.cfg.nearKm).toLocaleString()} km of your QTH.</div>`;
      return;
    }
    const max = Math.max(1, ...[...heard.values()].flatMap((m) => [...m.values()].map((c) => c.size)));
    this.body.innerHTML = `
      <div class="orow head muted"><span></span>${CONTINENTS.map((c) => `<span>${c}</span>`).join("")}</div>
      ${BANDS.map((band) => {
        const m = heard.get(band);
        const cur = ctx.onAir?.band === band ? " cur" : "";
        return `<div class="orow${m ? "" : " quiet"}${cur}">
          <span class="chip" style="--c:${bandColor(band)}">${band}</span>
          ${CONTINENTS.map((c) => {
            const n = m?.get(c)?.size ?? 0;
            // Brightness grows with how many stations were heard.
            const level = n ? 0.35 + 0.65 * Math.min(1, Math.log2(n + 1) / Math.log2(max + 1)) : 0;
            return `<span class="cell${n ? " on" : ""}" style="--c:${bandColor(band)};--a:${level.toFixed(2)}" title="${n ? `${n} station${n > 1 ? "s" : ""} in ${c} heard on ${band}` : ""}">${n || ""}</span>`;
          }).join("")}
        </div>`;
      }).join("")}`;
  }
}
