import type { Spot } from "./types.js";
import type { Settings } from "./settings.js";
import { modeGroup } from "./bands.js";
import type { ServerConfig } from "./types.js";

const HARD_MAX = 30000;
const HARD_AGE_MS = 60 * 60 * 1000;

/** Holds recent spots in arrival order (oldest first). */
export class SpotStore {
  private spots: Spot[] = [];
  private arrivals: number[] = []; // local receive times, for the rate meter

  replace(list: Spot[]): void {
    this.spots = list.slice(-HARD_MAX);
  }

  add(batch: Spot[]): void {
    const now = Date.now();
    for (let i = 0; i < batch.length; i++) this.arrivals.push(now);
    this.spots.push(...batch);
    if (this.spots.length > HARD_MAX) this.spots = this.spots.slice(-HARD_MAX);
  }

  prune(now: number): void {
    const cut = now - HARD_AGE_MS;
    let i = 0;
    while (i < this.spots.length && this.spots[i].t < cut) i++;
    if (i) this.spots = this.spots.slice(i);
    const rcut = now - 60_000;
    let j = 0;
    while (j < this.arrivals.length && this.arrivals[j] < rcut) j++;
    if (j) this.arrivals = this.arrivals.slice(j);
  }

  get size(): number {
    return this.spots.length;
  }

  get ratePerMin(): number {
    return this.arrivals.length;
  }

  /** Spots passing the user's filters, newest first. DX filters apply to "near" spots. */
  filtered(s: Settings, now: number, cfg: ServerConfig): Spot[] {
    const cut = now - s.maxAgeMin * 60_000;
    const out: Spot[] = [];
    for (let i = this.spots.length - 1; i >= 0; i--) {
      const sp = this.spots[i];
      if (sp.t < cut) continue;
      if (s.sources[sp.src] === false) continue;
      if (sp.rel === "here" && !s.show.heardHere) continue;
      if (sp.rel === "near" && !passesDX(sp, s, cfg)) continue;
      out.push(sp);
    }
    return out;
  }
}


/** Does a "near" spot pass the operator's DX filters? */
export function passesDX(sp: Spot, s: Settings, cfg: ServerConfig): boolean {
  const f = s.dx;
  if (f.bands.length && !f.bands.includes(sp.b)) return false;
  if (f.modes.length && !f.modes.includes(modeGroup(sp.m))) return false;
  if (f.hideCountry && cfg.country && sp.dxc === cfg.country) return false;
  if (f.hideCont && cfg.cont && sp.dxk === cfg.cont) return false;
  return true;
}
