import type { Panel, ServerConfig, Spot, UpdateContext } from "../types.js";
import { bandColor } from "../bands.js";
import { bearing } from "../astro.js";

const MAX_ROWS = 60;

/**
 * DX spotted by skimmers and cluster users near your QTH: stations you can
 * very likely hear right now. One row per station and band; the newest wins.
 */
export class DXSpots implements Panel {
  el: HTMLElement;
  private tbody: HTMLElement;
  private byId = new Map<number, Spot>();
  private seen = new Set<string>();
  private ctx?: UpdateContext;

  constructor(private cfg: ServerConfig) {
    this.el = document.createElement("section");
    this.el.className = "panel dxspots";
    this.el.innerHTML = `
      <h2>DX near you <span class="muted">spotted within ${Math.round(cfg.nearKm).toLocaleString()} km</span></h2>
      <div class="scroll"><table>
        <thead><tr><th>UTC</th><th class="num">kHz</th><th>Band</th><th>Mode</th><th>DX</th><th class="num">Az</th><th class="num">km</th><th class="num">Spots</th></tr></thead>
        <tbody></tbody>
      </table></div>`;
    this.tbody = this.el.querySelector("tbody")!;
    this.tbody.addEventListener("click", (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
      const s = tr && this.byId.get(Number(tr.dataset.id));
      if (s && s.dxla != null && s.dxlo != null) {
        this.ctx?.select({ call: s.dx, lat: s.dxla, lon: s.dxlo, grid: s.dxg, spot: s });
      }
    });
  }

  update(ctx: UpdateContext): void {
    this.ctx = ctx;
    const groups = new Map<string, { s: Spot; n: number }>();
    for (const s of ctx.spots) {
      if (s.rel !== "near") continue;
      const k = s.dx + "|" + s.b;
      const g = groups.get(k);
      if (g) g.n++;
      else groups.set(k, { s, n: 1 });
    }
    const rows = [...groups.values()].slice(0, MAX_ROWS);
    this.byId.clear();
    if (!rows.length) {
      this.tbody.innerHTML = `<tr><td colspan="8" class="muted hint">No DX spotted near you yet. RBN and cluster spots appear here once a nearby skimmer hears something.</td></tr>`;
      return;
    }
    const { lat, lon } = this.cfg;
    const next = new Set<string>();
    this.tbody.innerHTML = rows.map(({ s, n }) => {
      this.byId.set(s.id, s);
      const key = s.dx + "|" + s.b;
      next.add(key);
      const fresh = this.seen.size > 0 && !this.seen.has(key);
      const az = lat != null && lon != null && s.dxla != null && s.dxlo != null ? Math.round(bearing(lat, lon, s.dxla, s.dxlo)) : "";
      const d = new Date(s.t);
      const sel = ctx.dx?.call === s.dx ? "sel" : "";
      return `<tr data-id="${s.id}" class="${fresh ? "fresh" : ""} ${sel}" title="${esc(`${s.c ?? ""} · spotted by ${s.de} via ${s.src}`)}">
        <td class="muted">${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}</td>
        <td class="num">${s.f.toFixed(1)}</td>
        <td><span class="chip" style="--c:${bandColor(s.b)}">${s.b}</span></td>
        <td>${esc(s.m)}</td>
        <td class="call">${esc(s.dx)}</td>
        <td class="num">${az}${az !== "" ? "°" : ""}</td>
        <td class="num muted">${s.km != null ? Math.round(s.km).toLocaleString() : ""}</td>
        <td class="num muted">${n}</td>
      </tr>`;
    }).join("");
    this.seen = next;
  }
}

function esc(s = ""): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
