import type { Panel, ServerConfig, Spot, UpdateContext } from "../types.js";
import { bandColor, modeGroup } from "../bands.js";
import { km } from "../astro.js";

const CONTINENTS = ["NA", "SA", "EU", "AF", "AS", "OC"] as const;
const BANDS = ["160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"];
const WINDOW_MS = 15 * 60_000;
const REFRESH_MS = 60_000;

/** Skimmers count as "near you" only within this distance. */
const HINT_RADIUS_KM = 800; // ≈ 500 miles

/**
 * Only signals a modest station could plausibly work count as a hint:
 * skimmers with big antennas decode far weaker signals than you can.
 */
function strongEnough(s: Spot): boolean {
  if (s.snr == null) return s.src === "cluster"; // a person spotted it, so they heard it fine
  const m = modeGroup(s.m);
  return m === "CW" || m === "RTTY" ? s.snr >= 15 : s.snr >= -10;
}

/**
 * "Band openings": for each band and continent, is there a path from YOUR
 * QTH right now?
 *  - solid cell with a number: stations on that continent heard YOU
 *    (PSK Reporter / RBN) in the last 15 minutes. Direct evidence.
 *  - outlined cell: skimmers or cluster spotters within ~500 miles of you
 *    heard stations there with a signal a modest station could work.
 *    A hint, not proof.
 * Refreshes once a minute.
 */
export class Openings implements Panel {
  el: HTMLElement;
  private body: HTMLElement;
  private last = 0;
  private lastActive = "";

  constructor(private cfg: ServerConfig) {
    this.el = document.createElement("section");
    this.el.className = "panel openings";
    this.el.innerHTML = `
      <h2>Band openings <span class="muted">last 15 min</span></h2>
      <div class="orows"></div>
      <div class="olegend muted"><span><i class="you"></i>heard you</span><span><i class="hint"></i>strong signals heard within ${km(HINT_RADIUS_KM)} of you</span></div>`;
    this.body = this.el.querySelector(".orows")!;
  }

  update(ctx: UpdateContext): void {
    const active = ctx.onAir?.band ?? "";
    if (ctx.now - this.last < REFRESH_MS && this.last && active === this.lastActive) return;
    this.last = ctx.now;
    this.lastActive = active;

    const you = new Map<string, Map<string, Set<string>>>(); // band -> continent -> calls that heard me
    const hint = new Map<string, Set<string>>();              // band -> continents heard strongly nearby
    for (const s of ctx.spots) {
      if (ctx.now - s.t > WINDOW_MS || !s.b) continue;
      if (s.rel === "me" && s.dc) {
        const byCont = you.get(s.b) ?? new Map<string, Set<string>>();
        const calls = byCont.get(s.dc) ?? new Set<string>();
        calls.add(s.de);
        byCont.set(s.dc, calls);
        you.set(s.b, byCont);
      } else if (s.rel === "near" && s.dxk && (s.dek ?? Infinity) <= HINT_RADIUS_KM && strongEnough(s)) {
        if (this.cfg.country && s.dxc === this.cfg.country) continue; // your own country says nothing about propagation
        const set = hint.get(s.b) ?? new Set<string>();
        set.add(s.dxk);
        hint.set(s.b, set);
      }
    }

    this.body.innerHTML = `
      <div class="orow head muted"><span></span>${CONTINENTS.map((c) => `<span>${c}</span>`).join("")}</div>
      ${BANDS.map((band) => {
        const y = you.get(band), h = hint.get(band);
        const cur = active === band ? " cur" : "";
        return `<div class="orow${y || h ? "" : " quiet"}${cur}">
          <span class="chip" style="--c:${bandColor(band)}">${band}</span>
          ${CONTINENTS.map((c) => {
            const n = y?.get(c)?.size ?? 0;
            if (n) return `<span class="cell you" style="--c:${bandColor(band)}" title="${n} station${n > 1 ? "s" : ""} in ${c} heard you on ${band}">${n}</span>`;
            if (h?.has(c)) return `<span class="cell hint" style="--c:${bandColor(band)}" title="Stations within ${km(HINT_RADIUS_KM)} of you heard strong signals from ${c} on ${band}"></span>`;
            return `<span class="cell"></span>`;
          }).join("")}
        </div>`;
      }).join("")}`;
  }
}
