import type { Panel, ServerConfig, UpdateContext } from "../types.js";
import { bandColor } from "../bands.js";
import { hhmm } from "../astro.js";

/** Your most recent QSOs, from Wavelog. */
export class QSOPanel implements Panel {
  el: HTMLElement;
  private list: HTMLElement;

  constructor(private cfg: ServerConfig) {
    this.el = document.createElement("section");
    this.el.className = "panel qsos";
    this.el.innerHTML = `<h2>QSOs</h2><div class="list"></div>`;
    this.list = this.el.querySelector(".list")!;
  }

  update(ctx: UpdateContext): void {
    const wl = ctx.wavelog;
    const wlError = wl && !wl.ok && wl.error ? `<div class="wlerror" title="Run ./qthclock -check-wavelog on the Pi for details">Wavelog: ${esc(wl.error)}</div>` : "";
    if (!ctx.qsos.length) {
      this.list.innerHTML = wlError + `<div class="muted hint">${this.cfg.wavelog
        ? wl?.ok ? "No QSOs in Wavelog yet." : wlError ? "" : "Connecting to Wavelog…"
        : "Add your Wavelog URL and API key in config.json to show your latest QSOs here."}</div>`;
      return;
    }
    this.list.innerHTML = `<table><tbody>${ctx.qsos.slice(0, 6).map((q) => `
      <tr title="${[q.name, q.country, q.grid, `via ${q.src}`].filter(Boolean).join(" · ")}">
        <td class="muted">${hhmm(new Date(q.t))}</td>
        <td class="call">${q.call}</td>
        <td>${q.b ? `<span class="chip" style="--c:${bandColor(q.b)}">${q.b}</span>` : ""}</td>
        <td>${q.m ?? ""}</td>
        <td class="num muted">${q.sent ?? ""}</td>
        <td class="num">${q.rcvd ?? ""}</td>
        <td class="muted name">${q.name || q.country || ""}</td>
      </tr>`).join("")}</tbody></table>` + wlError;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
