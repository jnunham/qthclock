import { bandColor } from "../bands.js";
import { greatCircle, nightPolygon } from "../geo.js";
const MAX_ARCS = 1200;
const REDRAW_MS = 1500;
/** Picks a MapLibre map when the library loaded, else a plain canvas map. */
export function createMap(el, cfg, settings) {
    if (typeof maplibregl !== "undefined") {
        try {
            return new LiveMap(el, cfg, settings);
        }
        catch (e) {
            console.warn("MapLibre failed, using canvas map", e);
        }
    }
    return new CanvasMap(el, cfg, settings);
}
/**
 * Turn spots into what the map draws, from the operator's point of view:
 *  - "me":   a path from my QTH to each station hearing me, dot at the hearer
 *  - "here": a path from each station I hear to my QTH, dot at that station
 *  - "near": just a ring at the DX (no path; it was heard by someone near me)
 */
function buildGeometry(spots, now, maxAgeMin, arcs, home, activeBand) {
    const span = maxAgeMin * 60_000;
    const lines = [];
    const dots = new Map();
    for (const s of spots) {
        // Fade with age; when following the radio, other bands fade into the background.
        const op = Math.max(0.2, 1 - (now - s.t) / span) * (activeBand && s.b !== activeBand ? 0.22 : 1);
        const color = bandColor(s.b);
        const far = s.rel === "me" ? { call: s.de, lat: s.dela, lon: s.delo, grid: s.deg } : { call: s.dx, lat: s.dxla, lon: s.dxlo, grid: s.dxg };
        if (far.lat == null || far.lon == null)
            continue;
        const key = s.rel + "|" + far.call;
        if (!dots.has(key))
            dots.set(key, { lon: far.lon, lat: far.lat, color, op, kind: s.rel, call: far.call, grid: far.grid, spot: s });
        if (arcs && home && s.rel !== "near" && lines.length < MAX_ARCS) {
            lines.push({ coords: greatCircle(home.lat, home.lon, far.lat, far.lon, 24), color, op: op * 0.75, kind: s.rel });
        }
    }
    return { lines, dots: [...dots.values()] };
}
function selectFromDot(d) {
    return { call: d.call, lat: d.lat, lon: d.lon, grid: d.grid, spot: d.spot };
}
class LiveMap {
    cfg;
    settings;
    el;
    map;
    ready = false;
    lastDraw = 0;
    lastNight = 0;
    globe = false;
    dots = [];
    select;
    lastSel = "";
    constructor(el, cfg, settings) {
        this.cfg = cfg;
        this.settings = settings;
        this.el = el;
        this.map = new maplibregl.Map({
            container: el,
            style: cfg.mapStyle,
            center: [cfg.lon ?? 0, 25],
            zoom: 1.3,
            minZoom: 0.5,
            attributionControl: { compact: true },
        });
        this.map.on("load", () => this.onLoad());
        new ResizeObserver(() => this.map.resize()).observe(el);
    }
    onLoad() {
        const m = this.map;
        const empty = { type: "FeatureCollection", features: [] };
        for (const id of ["night", "arcs", "dots", "selpath", "home"])
            m.addSource(id, { type: "geojson", data: empty });
        m.addLayer({ id: "night", type: "fill", source: "night", paint: { "fill-color": "#000814", "fill-opacity": 0.45 } });
        // Paths: solid = someone hears me, dashed = I hear them. Colour = band.
        const arcPaint = { "line-color": ["get", "color"], "line-opacity": ["get", "op"], "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.1, 5, 2.5] };
        m.addLayer({ id: "arcs-me", type: "line", source: "arcs", filter: ["==", ["get", "kind"], "me"], layout: { "line-cap": "round" }, paint: arcPaint });
        m.addLayer({ id: "arcs-here", type: "line", source: "arcs", filter: ["==", ["get", "kind"], "here"], paint: { ...arcPaint, "line-dasharray": [3, 2] } });
        m.addLayer({
            id: "selpath", type: "line", source: "selpath", layout: { "line-cap": "round" },
            paint: { "line-color": "#ffffff", "line-width": 3.5, "line-opacity": 0.9 },
        });
        // Stations hearing me / I hear: filled dots. DX near me: hollow rings.
        m.addLayer({
            id: "dots", type: "circle", source: "dots",
            paint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["case", ["==", ["get", "kind"], "near"], 4, 3], 6, 8],
                "circle-color": ["case", ["==", ["get", "kind"], "near"], "rgba(0,0,0,0)", ["get", "color"]],
                "circle-opacity": ["get", "op"],
                "circle-stroke-color": ["case", ["==", ["get", "kind"], "near"], ["get", "color"], "#000"],
                "circle-stroke-width": ["case", ["==", ["get", "kind"], "near"], 1.8, 0.6],
                "circle-stroke-opacity": ["get", "op"],
            },
        });
        m.addLayer({
            id: "home", type: "circle", source: "home",
            paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": "#000", "circle-stroke-width": 2.5 },
        });
        if (this.cfg.lat != null && this.cfg.lon != null) {
            m.getSource("home").setData(feature({ type: "Point", coordinates: [this.cfg.lon, this.cfg.lat] }, {}));
        }
        m.on("click", "dots", (e) => {
            const d = this.dots[e.features[0].properties.i];
            if (d)
                this.select?.(selectFromDot(d));
        });
        m.on("mouseenter", "dots", () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", "dots", () => (m.getCanvas().style.cursor = ""));
        this.ready = true;
    }
    update(ctx) {
        this.select = ctx.select;
        if (!this.ready)
            return;
        const s = this.settings();
        if (s.globe !== this.globe) {
            this.globe = s.globe;
            try {
                this.map.setProjection({ type: s.globe ? "globe" : "mercator" });
            }
            catch { /* older MapLibre */ }
        }
        const nightHidden = this.map.getLayoutProperty("night", "visibility") === "none";
        if (ctx.now - this.lastNight > 60_000 || nightHidden === s.show.grayline) {
            this.lastNight = ctx.now;
            this.map.setLayoutProperty("night", "visibility", s.show.grayline ? "visible" : "none");
            this.map.getSource("night").setData(feature({ type: "Polygon", coordinates: [nightPolygon(new Date(ctx.now))] }, {}));
        }
        const selKey = ctx.dx ? `${ctx.dx.call}|${ctx.dx.lat}|${ctx.dx.lon}` : "";
        if (selKey !== this.lastSel) {
            this.lastSel = selKey;
            const home = this.cfg;
            this.map.getSource("selpath").setData(ctx.dx && home.lat != null && home.lon != null
                ? feature({ type: "LineString", coordinates: greatCircle(home.lat, home.lon, ctx.dx.lat, ctx.dx.lon, 64) }, {})
                : { type: "FeatureCollection", features: [] });
        }
        if (ctx.now - this.lastDraw < REDRAW_MS)
            return;
        this.lastDraw = ctx.now;
        const home = this.cfg.lat != null && this.cfg.lon != null ? { lat: this.cfg.lat, lon: this.cfg.lon } : undefined;
        const g = buildGeometry(ctx.spots, ctx.now, s.maxAgeMin, s.show.arcs, home, ctx.active?.band);
        this.dots = g.dots;
        this.map.getSource("arcs").setData({
            type: "FeatureCollection",
            features: g.lines.map((l) => feature({ type: "LineString", coordinates: l.coords }, { color: l.color, op: l.op, kind: l.kind })),
        });
        this.map.getSource("dots").setData({
            type: "FeatureCollection",
            features: g.dots.map((d, i) => feature({ type: "Point", coordinates: [d.lon, d.lat] }, { color: d.color, op: d.op, kind: d.kind, i })),
        });
    }
}
function feature(geometry, properties) {
    return { type: "Feature", properties, geometry };
}
/**
 * Fallback when the map library can't load (offline Pi, CDN blocked):
 * an equirectangular grid with gray line, paths and dots. No coastlines.
 */
class CanvasMap {
    cfg;
    settings;
    el;
    canvas;
    hit = [];
    select;
    constructor(el, cfg, settings) {
        this.cfg = cfg;
        this.settings = settings;
        this.el = el;
        this.canvas = document.createElement("canvas");
        el.append(this.canvas);
        const note = document.createElement("div");
        note.className = "map-note muted";
        note.textContent = "Basemap unavailable (offline?) · showing grid map";
        el.append(note);
        this.canvas.addEventListener("click", (e) => {
            const r = this.canvas.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            let best, bd = 12 * 12;
            for (const h of this.hit) {
                const dd = (h.x - x) ** 2 + (h.y - y) ** 2;
                if (dd < bd) {
                    bd = dd;
                    best = h.d;
                }
            }
            if (best)
                this.select?.(selectFromDot(best));
        });
    }
    update(ctx) {
        this.select = ctx.select;
        const s = this.settings();
        const dpr = window.devicePixelRatio || 1;
        const w = this.el.clientWidth, h = this.el.clientHeight;
        if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
            this.canvas.width = w * dpr;
            this.canvas.height = h * dpr;
        }
        const c = this.canvas.getContext("2d");
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const ww = Math.min(w, h * 2), wh = ww / 2;
        const ox = (w - ww) / 2, oy = (h - wh) / 2;
        const X = (lon) => ox + ((((lon + 540) % 360) - 180 + 180) / 360) * ww;
        const Y = (lat) => oy + ((90 - lat) / 180) * wh;
        const css = getComputedStyle(document.documentElement);
        c.clearRect(0, 0, w, h);
        c.fillStyle = css.getPropertyValue("--map-sea").trim() || "#0b1622";
        c.fillRect(ox, oy, ww, wh);
        c.strokeStyle = "rgba(255,255,255,0.08)";
        c.lineWidth = 1;
        for (let lon = -180; lon <= 180; lon += 30) {
            c.beginPath();
            c.moveTo(ox + ((lon + 180) / 360) * ww, Y(90));
            c.lineTo(ox + ((lon + 180) / 360) * ww, Y(-90));
            c.stroke();
        }
        for (let lat = -60; lat <= 60; lat += 30) {
            c.beginPath();
            c.moveTo(ox, Y(lat));
            c.lineTo(ox + ww, Y(lat));
            c.stroke();
        }
        if (s.show.grayline) {
            const ring = nightPolygon(new Date(ctx.now), 90);
            c.fillStyle = "rgba(0,0,0,0.45)";
            c.beginPath();
            ring.forEach(([lo, la], i) => { const x = ox + ((lo + 180) / 360) * ww; i ? c.lineTo(x, Y(la)) : c.moveTo(x, Y(la)); });
            c.fill();
        }
        const path = (coords) => {
            c.beginPath();
            coords.forEach(([lo, la], i) => {
                const wrapped = ((lo + 540) % 360) - 180;
                const prev = i ? ((coords[i - 1][0] + 540) % 360) - 180 : wrapped;
                if (i === 0 || Math.abs(wrapped - prev) > 180)
                    c.moveTo(X(wrapped), Y(la));
                else
                    c.lineTo(X(wrapped), Y(la));
            });
            c.stroke();
        };
        const home = this.cfg.lat != null && this.cfg.lon != null ? { lat: this.cfg.lat, lon: this.cfg.lon } : undefined;
        const g = buildGeometry(ctx.spots, ctx.now, s.maxAgeMin, s.show.arcs, home, ctx.active?.band);
        c.save();
        c.beginPath();
        c.rect(ox, oy, ww, wh);
        c.clip();
        c.lineWidth = 1.2;
        for (const l of g.lines) {
            c.strokeStyle = l.color;
            c.globalAlpha = l.op;
            c.setLineDash(l.kind === "here" ? [6, 4] : []);
            path(l.coords);
        }
        c.setLineDash([]);
        if (ctx.dx && home) {
            c.globalAlpha = 0.9;
            c.strokeStyle = "#fff";
            c.lineWidth = 3.5;
            path(greatCircle(home.lat, home.lon, ctx.dx.lat, ctx.dx.lon, 64));
        }
        this.hit = [];
        for (const d of g.dots) {
            const x = X(d.lon), y = Y(d.lat);
            this.hit.push({ x, y, d });
            c.globalAlpha = d.op;
            c.beginPath();
            c.arc(x, y, d.kind === "near" ? 4.5 : 3.5, 0, Math.PI * 2);
            if (d.kind === "near") {
                c.strokeStyle = d.color;
                c.lineWidth = 1.8;
                c.stroke();
            }
            else {
                c.fillStyle = d.color;
                c.fill();
            }
        }
        c.restore();
        c.globalAlpha = 1;
        if (home) {
            c.fillStyle = "#fff";
            c.strokeStyle = "#000";
            c.lineWidth = 2.5;
            c.beginPath();
            c.arc(X(home.lon), Y(home.lat), 7, 0, Math.PI * 2);
            c.fill();
            c.stroke();
        }
    }
}
//# sourceMappingURL=map.js.map