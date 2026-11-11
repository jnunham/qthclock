import type { Panel, ServerConfig, UpdateContext } from "../types.js";
import { bandColor } from "../bands.js";
import { hhmm } from "../astro.js";

/**
 * "Now working" (live from WSJT-X) above your most recent QSOs (from Wavelog
 * and/or WSJT-X's "QSO logged" messages).
 */
export class QSOPanel implements Panel {
  el: HTMLElement;
  private now: HTMLElement;
  private list: HTMLElement;

  constructor(private cfg: ServerConfig) {
    this.el = document.createElement("section");
    this.el.className = "panel qsos";
    this.el.innerHTML = `<h2>QSOs</h2><div class="now"></div><div class="list"></div>`;
    this.now = this.el.querySelector(".now")!;
    this.list = this.el.querySelector(".list")!;
  }

  update(ctx: UpdateContext): void {
    const w = ctx.working;
    if (w && w.call) {
      this.now.innerHTML = `
        <div class="working ${w.tx ? "tx" : ""}">
          <span class="badge">${w.tx ? "TX" : "RX"}</span>
          <span class="call">${w.call}</span>
          <span class="muted">${w.grid ?? ""}</span>
          <span class="spacer"></span>
          <span>${(w.f / 1000).toFixed(3)} MHz ${w.m}</span>
          ${w.report ? `<span class="muted">sent ${w.report}</span>` : ""}
        </div>`;
    } else if (w) {
      this.now.innerHTML = `<div class="working idle"><span class="badge">RX</span><span class="muted">Not in a QSO · ${(w.f / 1000).toFixed(3)} MHz ${w.m}</span></div>`;
    } else {
      this.now.innerHTML = "";
    }

    const wl = ctx.wavelog;
    const wlError = wl && !wl.ok && wl.error ? `<div class="wlerror" title="Run ./qthclock -check-wavelog on the Pi for details">Wavelog: ${esc(wl.error)}</div>` : "";
    if (!ctx.qsos.length) {
      this.list.innerHTML = wlError + `<div class="muted hint">${this.cfg.wavelog
        ? wl?.ok ? "No QSOs in Wavelog yet." : wlError ? "" : "Connecting to Wavelog…"
        : "QSOs you log in WSJT-X show here. Add your Wavelog URL and API key in config.json to show your logbook."}</div>`;
      return;
    }
    this.list.innerHTML = `<table><tbody>${ctx.qsos.slice(0, 5).map((q) => `
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
