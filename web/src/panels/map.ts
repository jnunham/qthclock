import type { DXSelection, Panel, ServerConfig, Spot, UpdateContext } from "../types.js";
import type { MapView, Settings } from "../settings.js";
import { bandColor } from "../bands.js";
import { greatCircle, nightImage } from "../geo.js";
import { loadWorld, type World } from "../world.js";

const MAX_ARCS = 1200;
export const MAX_ZOOM_STEPS = 4;

/**
 * The map always spans all 360° of longitude across the panel. How much
 * latitude shows depends on the panel's shape: a wide, short panel shows
 * about 70°N to 40°S (everywhere you'll realistically spot), a taller one
 * shows more, up to pole to pole. Only if the panel is extremely wide does
 * the map stop filling the width, rather than cropping more than that.
 */
const MIN_LAT_SPAN = 110;

type LonLat = [number, number];
interface Arc { coords: LonLat[]; color: string; op: number }
interface Dot { lon: number; lat: number; color: string; op: number; call: string; grid?: string; spot: Spot }

/** What the map draws: a line from my QTH to each station hearing me, and a dot where it is. */
function buildGeometry(spots: Spot[], now: number, maxAgeMin: number, arcs: boolean, home?: { lat: number; lon: number }, activeBand?: string) {
  const span = maxAgeMin * 60_000;
  const lines: Arc[] = [];
  const dots = new Map<string, Dot>();
  for (const s of spots) {
    if (s.rel !== "me") continue;
    // Fade with age; bands you're not on fade into the background.
    const op = Math.max(0.25, 1 - (now - s.t) / span) * (activeBand && s.b !== activeBand ? 0.22 : 1);
    const color = bandColor(s.b);
    const far = { call: s.de, lat: s.dela, lon: s.delo, grid: s.deg };
    if (far.lat == null || far.lon == null) continue;
    if (!dots.has(far.call)) dots.set(far.call, { lon: far.lon, lat: far.lat, color, op, call: far.call, grid: far.grid, spot: s });
    if (arcs && home && lines.length < MAX_ARCS) {
      lines.push({ coords: greatCircle(home.lat, home.lon, far.lat, far.lon, 32), color, op: op * 0.8 });
    }
  }
  return { lines, dots: [...dots.values()] };
}

/**
 * The world map: a flat (equirectangular) projection like HamClock's, drawn
 * on a canvas. At zoom 0 the whole world always fits once, whatever the
 * screen shape. Coastlines/borders are drawn to an off-screen layer only when
 * the view changes; spots are drawn on top each second.
 */
export class WorldMap implements Panel {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private base = document.createElement("canvas");
  private baseKey = "";
  private world?: World;
  private hit: { x: number; y: number; d: Dot }[] = [];
  private night?: { img: HTMLCanvasElement; at: number; theme: string };
  private select?: (s: DXSelection | undefined) => void;

  constructor(el: HTMLElement, private cfg: ServerConfig, private settings: () => Settings) {
    this.el = el;
    this.canvas = document.createElement("canvas");
    el.append(this.canvas);
    // The server builds the outlines on first start (a few seconds to
    // download); keep asking until they're ready, then redraw.
    const note = document.createElement("div");
    note.className = "map-note muted";
    const tryLoad = (attempt: number) => {
      loadWorld().then((w) => {
        if (w) {
          this.world = w;
          this.baseKey = "";
          note.remove();
          return;
        }
        if (attempt === 1) {
          note.textContent = "Map outlines are still downloading on the QTHClock server · showing grid";
          el.append(note);
        }
        setTimeout(() => tryLoad(attempt + 1), Math.min(60_000, 5_000 * attempt));
      });
    };
    tryLoad(0);
    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best: Dot | undefined, bd = 16 * 16;
      for (const h of this.hit) {
        const dd = (h.x - x) ** 2 + (h.y - y) ** 2;
        if (dd < bd) { bd = dd; best = h.d; }
      }
      if (best) this.select?.({ call: best.call, lat: best.lat, lon: best.lon, grid: best.grid, spot: best.spot, reason: "manual" });
    });
  }

  /** Projection for the current panel size and zoom setting. */
  private projection(w: number, h: number, view: MapView) {
    // Pixels per degree: fill the width, unless that would crop below MIN_LAT_SPAN.
    const fit = Math.min(w / 360, h / MIN_LAT_SPAN);
    const span = Math.min(180, h / fit); // latitude shown at zoom 0
    const k = fit * 2 ** view.zoom;
    const zoomed = view.zoom > 0 && view.center === "home" && this.cfg.lat != null && this.cfg.lon != null;
    const cLon = zoomed ? this.cfg.lon! : 0;
    // When latitude is cropped, favour the north (where most stations are).
    let cLat = zoomed ? this.cfg.lat! : 15 * (1 - (span - MIN_LAT_SPAN) / (180 - MIN_LAT_SPAN));
    // Don't scroll past the top/bottom of the world when zoomed in.
    const halfH = h / 2 / k;
    cLat = Math.min(90 - halfH, Math.max(-90 + halfH, cLat));
    if (halfH >= 90) cLat = 0;
    const X = (lon: number) => w / 2 + (lon - cLon) * k;              // no wrapping
    const rel = (lon: number) => ((((lon - cLon) % 360) + 540) % 360) - 180;
    const Xw = (lon: number) => w / 2 + rel(lon) * k;                  // wrapped around the centre
    const Y = (lat: number) => h / 2 + (cLat - lat) * k;
    return { k, cLon, X, Xw, Y, rel, left: w / 2 - 180 * k, right: w / 2 + 180 * k };
  }

  private drawBase(w: number, h: number, dpr: number, s: Settings, P: ReturnType<WorldMap["projection"]>) {
    const key = `${w}x${h}@${dpr}|${s.map.zoom}|${s.map.center}|${s.theme}|${this.world ? 1 : 0}`;
    if (key === this.baseKey) return;
    this.baseKey = key;
    this.base.width = w * dpr;
    this.base.height = h * dpr;
    const c = this.base.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;

    c.fillStyle = v("--map-sea", "#0b1622");
    c.fillRect(Math.max(0, P.left), Math.max(0, P.Y(90)), Math.min(w, P.right) - Math.max(0, P.left), Math.min(h, P.Y(-90)) - Math.max(0, P.Y(90)));

    // Graticule every 30°, under the land.
    c.strokeStyle = v("--map-grid", "rgba(255,255,255,0.05)");
    c.lineWidth = 1;
    c.beginPath();
    for (let lon = -180; lon < 180; lon += 30) { c.moveTo(P.Xw(lon), P.Y(90)); c.lineTo(P.Xw(lon), P.Y(-90)); }
    for (let lat = -60; lat <= 60; lat += 30) { c.moveTo(0, P.Y(lat)); c.lineTo(w, P.Y(lat)); }
    c.stroke();

    const world = this.world;
    if (!world) return;
    // Each shape is drawn shifted by ±360° too when the view is centred off
    // Greenwich, so nothing is cut at the edge of the map.
    const shifts = P.cLon === 0 ? [0] : [-360, 0, 360];
    const trace = (pts: Float32Array, shift: number, close: boolean) => {
      c.moveTo(P.X(pts[0] + shift), P.Y(pts[1]));
      for (let i = 2; i < pts.length; i += 2) c.lineTo(P.X(pts[i] + shift), P.Y(pts[i + 1]));
      if (close) c.closePath();
    };
    const fillPolys = (polys: Float32Array[][], color: string) => {
      c.fillStyle = color;
      for (const shift of shifts) {
        c.beginPath();
        for (const poly of polys) for (const ring of poly) trace(ring, shift, true);
        c.fill("evenodd");
      }
    };
    const strokePolys = (polys: Float32Array[][], color: string, width: number) => {
      c.strokeStyle = color; c.lineWidth = width;
      for (const shift of shifts) {
        c.beginPath();
        for (const poly of polys) for (const ring of poly) trace(ring, shift, true);
        c.stroke();
      }
    };
    const strokeLines = (lines: Float32Array[], color: string, width: number) => {
      c.strokeStyle = color; c.lineWidth = width;
      for (const shift of shifts) {
        c.beginPath();
        for (const l of lines) trace(l, shift, false);
        c.stroke();
      }
    };
    c.lineJoin = "round";
    c.lineCap = "round";
    // Line weights grow gently with zoom so detail stays crisp.
    const lw = Math.max(0.6, Math.min(1.6, 0.55 + P.k / 12));

    fillPolys(world.land, v("--map-land", "#1f3247"));
    fillPolys(world.lakes, v("--map-sea", "#0b1826"));
    strokeLines(world.states, v("--map-state", "rgba(150,190,230,0.16)"), lw * 0.6);
    strokeLines(world.borders, v("--map-border", "rgba(150,190,230,0.32)"), lw * 0.85);
    strokePolys(world.lakes, v("--map-coast", "rgba(150,190,230,0.45)"), lw * 0.7);
    strokePolys(world.land, v("--map-coast", "rgba(150,190,230,0.45)"), lw);
  }

  update(ctx: UpdateContext): void {
    this.select = ctx.select;
    const s = this.settings();
    const dpr = window.devicePixelRatio || 1;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const P = this.projection(w, h, s.map);
    this.drawBase(w, h, dpr, s, P);

    const c = this.canvas.getContext("2d")!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.base, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.save();
    c.beginPath();
    c.rect(Math.max(0, P.left), 0, Math.min(w, P.right) - Math.max(0, P.left), h);
    c.clip();

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#4dabf7";
    const text = css.getPropertyValue("--text").trim() || "#fff";
    const label = (t: string, x: number, y: number) => {
      c.font = `600 ${Math.round(11 * f)}px system-ui, sans-serif`;
      c.textBaseline = "middle";
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.65)"; c.strokeText(t, x, y);
      c.fillStyle = text; c.fillText(t, x, y);
    };
    // Lines and dots grow with screen size, the text-size setting and zoom.
    const f = Math.min(2.2, Math.max(1, w / 1600)) * Math.max(0.8, s.scale) * (1 + 0.15 * s.map.zoom);

    if (s.show.grayline) {
      // Smooth gray line: recomputed once a minute, scaled onto the map.
      if (!this.night || ctx.now - this.night.at > 60_000 || this.night.theme !== s.theme) {
        const css = getComputedStyle(document.documentElement);
        const alpha = Number(css.getPropertyValue("--map-night-alpha")) || 0.5;
        this.night = { img: nightImage(new Date(ctx.now), alpha), at: ctx.now, theme: s.theme };
      }
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = "high";
      for (const shift of P.cLon === 0 ? [0] : [-360, 0, 360]) {
        c.drawImage(this.night.img, P.X(-180 + shift), P.Y(90), 360 * P.k, 180 * P.k);
      }
    }

    const path = (coords: LonLat[]) => {
      c.beginPath();
      coords.forEach(([lo, la], i) => {
        const prev = i ? P.rel(coords[i - 1][0]) : P.rel(lo);
        if (i === 0 || Math.abs(P.rel(lo) - prev) > 180) c.moveTo(P.Xw(lo), P.Y(la)); else c.lineTo(P.Xw(lo), P.Y(la));
      });
      c.stroke();
    };

    const home = this.cfg.lat != null && this.cfg.lon != null ? { lat: this.cfg.lat, lon: this.cfg.lon } : undefined;
    const g = buildGeometry(ctx.spots, ctx.now, s.maxAgeMin, s.show.arcs, home, ctx.active?.band);
    c.lineWidth = 1.05 * f;
    c.lineCap = "round";
    for (const l of g.lines) { c.strokeStyle = l.color; c.globalAlpha = l.op; path(l.coords); }
    // A fine dashed line to a station you clicked.
    if (ctx.dx?.reason === "manual" && home) {
      c.globalAlpha = 0.85; c.strokeStyle = accent; c.lineWidth = 1.4 * f;
      c.setLineDash([5 * f, 4 * f]);
      path(greatCircle(home.lat, home.lon, ctx.dx.lat, ctx.dx.lon, 64));
      c.setLineDash([]);
    }
    this.hit = [];
    for (const d of g.dots) {
      const x = P.Xw(d.lon), y = P.Y(d.lat);
      this.hit.push({ x, y, d });
      c.globalAlpha = d.op;
      c.beginPath(); c.arc(x, y, 3.5 * f, 0, Math.PI * 2);
      c.fillStyle = d.color; c.fill(); c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 0.8; c.stroke();
    }
    c.globalAlpha = 1;
    // The DX station (last QSO or clicked): a small reticle with its call,
    // in the theme's accent colour.
    if (ctx.dx) {
      const x = P.Xw(ctx.dx.lon), y = P.Y(ctx.dx.lat);
      const r = 5 * f;
      c.strokeStyle = accent; c.lineWidth = 1.3 * f;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
      c.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        c.moveTo(x + dx * (r + 2 * f), y + dy * (r + 2 * f));
        c.lineTo(x + dx * (r + 5 * f), y + dy * (r + 5 * f));
      }
      c.stroke();
      label(ctx.dx.call, x + r + 7 * f, y);
    }
    // Home: a small dot with a soft halo.
    if (home) {
      const x = P.Xw(home.lon), y = P.Y(home.lat);
      c.fillStyle = accent; c.globalAlpha = 0.25;
      c.beginPath(); c.arc(x, y, 7 * f, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1; c.fillStyle = text;
      c.beginPath(); c.arc(x, y, 3 * f, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
