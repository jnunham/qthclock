import type { Panel, Spot, UpdateContext } from "../types.js";
import { BANDS, bandColor } from "../bands.js";
import { km } from "../astro.js";

/**
 * Per-band summary of one side of your signal path:
 *   "me"   -> My signal: how many stations hear you, farthest one, best report
 *   "here" -> Heard here: what your own receiver is decoding
 */
export class BandSummary implements Panel {
  el: HTMLElement;
  private body: HTMLElement;
  private rows = new Map<string, Spot>();

  constructor(private rel: "me" | "here", title: string, private emptyHint: string) {
    this.el = document.createElement("section");
    this.el.className = `panel summary ${rel}`;
    this.el.innerHTML = `<h2>${title} <span class="muted count"></span></h2><div class="rows"></div>`;
    this.body = this.el.querySelector(".rows")!;
    this.body.addEventListener("click", (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>("[data-band]");
      const s = tr && this.rows.get(tr.dataset.band!);
      if (s) this.select?.(s);
    });
  }

  private select?: (s: Spot) => void;

  update(ctx: UpdateContext): void {
    const per = new Map<string, { calls: Set<string>; far?: Spot; best?: number }>();
    for (const s of ctx.spots) {
      if (s.rel !== this.rel) continue;
      const other = this.rel === "me" ? s.de : s.dx;
      const b = per.get(s.b) ?? { calls: new Set<string>() };
      b.calls.add(other);
      if (s.km != null && (b.far?.km == null || s.km > b.far.km)) b.far = s;
      if (s.snr != null && (b.best == null || s.snr > b.best)) b.best = s.snr;
      per.set(s.b, b);
    }
    const total = new Set<string>();
    per.forEach((b) => b.calls.forEach((c) => total.add(c)));
    this.el.querySelector(".count")!.textContent = total.size ? `${total.size} stations` : "";

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
    const max = Math.max(...[...per.values()].map((b) => b.calls.size));
    this.rows.clear();
    this.body.innerHTML = BANDS.filter((b) => per.has(b)).map((band) => {
      const b = per.get(band)!;
      if (b.far) this.rows.set(band, b.far);
      const farCall = b.far ? (this.rel === "me" ? b.far.de : b.far.dx) : "";
      return `<div class="srow" data-band="${band}" title="Click to show the farthest station as DX">
        <span class="chip" style="--c:${bandColor(band)}">${band}</span>
        <span class="track"><span class="fill" style="width:${(b.calls.size / max) * 100}%;background:${bandColor(band)}"></span></span>
        <span class="n">${b.calls.size}</span>
        <span class="far">${farCall ? `<b>${farCall}</b> <span class="muted">${km(b.far!.km!)}</span>` : ""}</span>
        <span class="n muted">${b.best != null ? `${b.best > 0 ? "+" : ""}${b.best}` : ""}</span>
      </div>`;
    }).join("");
  }
}
