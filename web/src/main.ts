import type { DXSelection, OnAir, Panel, QSO, ServerConfig, Solar, Spot, UpdateContext } from "./types.js";
import { fetchSettings, mergeSettings, saveSettings, urlOverrides, type Settings } from "./settings.js";
import { SpotStore } from "./store.js";
import { connectStream } from "./stream.js";
import { initDrawer } from "./drawer.js";
import { TopBar } from "./panels/topbar.js";
import { WorldMap, MAX_ZOOM_STEPS } from "./panels/map.js";
import { DeDx } from "./panels/dedx.js";
import { BandSummary } from "./panels/bandsummary.js";
import { Openings } from "./panels/openings.js";
import { showSetup } from "./setup.js";
import { QSOPanel } from "./panels/qsos.js";
import { modeGroup } from "./bands.js";
import { SpaceWeather } from "./panels/space.js";
import { setUnits } from "./astro.js";
import { gridFor, type PanelId } from "./layout.js";

/** A station you click stays the DX this long, then the display goes back to your last QSO. */
const MANUAL_HOLD_MS = 3 * 60_000;
/** Your last Wavelog QSO is shown as the DX for this long. */
const LAST_QSO_MS = 2 * 60 * 60_000;
/** "On air" looks at spots of you from the last 10 minutes. */
const ON_AIR_MS = 10 * 60_000;

/**
 * Work out the band and mode you're on from who's hearing you, like HamSpotter
 * or HamAlert: the band/mode with the most spots of you, counting the last
 * 5 minutes fully and the 5 before that at a third.
 */
function onAirFrom(spots: Spot[], now: number): OnAir | undefined {
  const score = new Map<string, { band: string; mode: string; w: number; last: number; count: number }>();
  for (const s of spots) {
    if (s.rel !== "me" || !s.b || now - s.t > ON_AIR_MS) continue;
    const mode = modeGroup(s.m);
    const key = s.b + "|" + mode;
    const e = score.get(key) ?? { band: s.b, mode, w: 0, last: 0, count: 0 };
    e.w += now - s.t < ON_AIR_MS / 2 ? 1 : 1 / 3;
    e.last = Math.max(e.last, s.t);
    e.count++;
    score.set(key, e);
  }
  let best: { band: string; mode: string; w: number; last: number; count: number } | undefined;
  for (const e of score.values()) if (!best || e.w > best.w) best = e;
  return best && { band: best.band, mode: best.mode, last: best.last, count: best.count };
}

async function main() {
  const cfg: ServerConfig = await fetch("api/config").then((r) => r.json());
  if (!cfg.configured && !cfg.demo) {
    await showSetup(cfg, true); // reloads the page once saved
    return;
  }

  // Shared settings (from the server) + this screen's URL overrides.
  const overrides = urlOverrides();
  let shared = await fetchSettings();
  let settings: Settings = { ...shared, ...overrides };
  const get = () => settings;

  const store = new SpotStore();
  let solar: Solar | undefined;
  let connected = false;
  let qsos: QSO[] = [];
  let wavelog: UpdateContext["wavelog"];
  let manual: { sel: DXSelection; at: number } | undefined;

  const topbar = new TopBar(document.getElementById("topbar")!, cfg, get);
  const map = new WorldMap(document.getElementById("map")!, cfg, get);
  const dedx = new DeDx(cfg);
  const mySignal = new BandSummary("me", "My signal · who hears me",
    cfg.callsign ? "Nobody has reported you yet. Call CQ on FT8, or check RBN for CW." : 'Set "callsign" in config.json.');
  const openings = new Openings(cfg);
  const space = new SpaceWeather();
  const qsoPanel = new QSOPanel(cfg);

  const side = document.getElementById("side")!;
  const sideItems: [Panel, keyof Settings["show"]][] = [
    [dedx, "dedx"], [qsoPanel, "log"], [mySignal, "mySignal"], [openings, "openings"], [space, "space"],
  ];
  for (const [p] of sideItems) side.append(p.el);

  const ids: [Panel, PanelId][] = [[dedx, "dedx"], [qsoPanel, "log"], [mySignal, "mySignal"], [openings, "openings"], [space, "space"]];
  const applyLayout = () => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    setUnits(settings.units);
    root.style.setProperty("--scale", String(settings.scale));
    const visible = ids.filter(([, id]) => settings.show[id === "log" ? "log" : id]).map(([, id]) => id);
    const body = document.getElementById("body")!;
    const remPx = parseFloat(getComputedStyle(root).fontSize) || 16;
    const g = gridFor(settings.preset, visible, body.clientWidth || window.innerWidth, body.clientHeight || window.innerHeight * 0.9, remPx);
    body.style.gridTemplateColumns = g.columns;
    body.style.gridTemplateRows = g.rows;
    body.style.gridTemplateAreas = g.areas.map((r) => `"${r.join(" ")}"`).join(" ");
    for (const [panel, id] of ids) {
      panel.el.hidden = !g.areas.some((r) => r.includes(id));
      panel.el.style.gridArea = id;
    }
    document.getElementById("map-wrap")!.style.gridArea = "map";
  };
  window.addEventListener("resize", () => applyLayout());
  applyLayout();

  const applyShared = (s: Settings) => {
    shared = s;
    settings = { ...shared, ...overrides };
    applyLayout();
    tick(true);
  };

  /** Save a settings change: shared with every screen, except this screen's URL overrides. */
  const commit = (s: Settings) => {
    const toSave = { ...s } as Record<string, unknown>;
    for (const k of Object.keys(overrides)) toSave[k] = (shared as unknown as Record<string, unknown>)[k];
    applyShared(toSave as unknown as Settings);
    saveSettings(toSave as unknown as Settings);
  };
  initDrawer(cfg, get, () => showSetup(cfg, false), commit);
  initMapControls(get, commit);

  connectStream({
    snapshot: (list) => store.replace(list),
    spots: (batch) => store.add(batch),
    solar: (s) => (solar = s),
    qsos: (q) => {
      qsos = q;
      tick(true);
    },
    wavelog: (w) => {
      wavelog = w;
      tick(true);
    },
    settings: (s) => {
      // Another screen (e.g. your phone) changed the settings.
      if (JSON.stringify(s) !== JSON.stringify(shared)) applyShared(mergeSettings(s as Partial<Settings>));
    },
    status: async (ok) => {
      connected = ok;
      // Hands-off updates: if the server restarted (e.g. after a git pull),
      // reload so the monitor runs the new version without anyone touching it.
      if (ok) {
        const now: ServerConfig | undefined = await fetch("api/config").then((r) => r.json()).catch(() => undefined);
        if (now && now.boot !== cfg.boot) location.reload();
      }
    },
  });

  const select = (sel: DXSelection | undefined) => {
    manual = sel ? { sel: { ...sel, reason: "manual" }, at: Date.now() } : undefined;
    tick(true);
  };

  // Calm display: the clock ticks every second; the map and panels redraw
  // every few seconds (or right away when you change something).
  const SLOW_MS = 5000;
  const panels: Panel[] = [map, ...sideItems.map(([p]) => p)];
  let lastTick = 0, lastSlow = 0;
  const tick = (force = false) => {
    const now = Date.now();
    if (!force && now - lastTick < 1000) return;
    lastTick = now;
    const slow = force || now - lastSlow >= SLOW_MS;
    store.prune(now);

    // Band/mode you're on, from your own spots; the display follows it.
    const recent = store.filtered({ ...settings, maxAgeMin: Math.max(settings.maxAgeMin, 10) }, now);
    const onAir = onAirFrom(recent, now);
    const active = settings.followRadio && onAir ? { band: onAir.band, mode: onAir.mode } : undefined;
    const spots = store.filtered(settings, now);

    // DX: a station you clicked (for a few minutes), else your last QSO.
    if (manual && now - manual.at > MANUAL_HOLD_MS) manual = undefined;
    const q = qsos[0];
    const last: DXSelection | undefined = q && q.lat != null && q.lon != null && now - q.t < LAST_QSO_MS
      ? { call: q.call, lat: q.lat, lon: q.lon, grid: q.grid, reason: "last" }
      : undefined;
    const dx = manual?.sel || last;

    const ctx: UpdateContext = {
      now, spots, allCount: store.size, ratePerMin: store.ratePerMin,
      solar, connected, dx, select, qsos, wavelog, onAir, active,
    };
    for (const p of slow ? [topbar, ...panels] : [topbar]) {
      if (p.el.hidden) continue;
      try {
        p.update(ctx);
      } catch (e) {
        console.error("panel update failed", e);
      }
    }
    if (slow) lastSlow = now;
  };
  setInterval(() => tick(), 250);
  tick(true);
}

/** Zoom buttons on the map. They fade out with the mouse, like the gear. */
function initMapControls(get: () => Settings, commit: (s: Settings) => void) {
  const box = document.createElement("div");
  box.id = "mapctl";
  box.innerHTML = `
    <button data-z="in" title="Zoom in">+</button>
    <button data-z="out" title="Zoom out">−</button>
    <button data-z="world" title="Whole world">⌂</button>`;
  document.getElementById("map-wrap")!.append(box);
  box.addEventListener("click", (e) => {
    const z = (e.target as HTMLElement).dataset.z;
    if (!z) return;
    const s = structuredClone(get());
    if (z === "in") s.map.zoom = Math.min(MAX_ZOOM_STEPS, s.map.zoom + 0.5);
    if (z === "out") s.map.zoom = Math.max(0, s.map.zoom - 0.5);
    if (z === "world") s.map.zoom = 0;
    commit(s);
  });
}

main().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:2rem">QTHClock failed to start:\n${e}</pre>`;
});
