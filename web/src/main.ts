import type { DXSelection, Panel, QSO, ServerConfig, Solar, UpdateContext, Working } from "./types.js";
import { loadSettings, saveSettings, PRESETS, type Settings } from "./settings.js";
import { SpotStore } from "./store.js";
import { connectStream } from "./stream.js";
import { initDrawer } from "./drawer.js";
import { TopBar } from "./panels/topbar.js";
import { createMap } from "./panels/map.js";
import { DeDx } from "./panels/dedx.js";
import { BandSummary } from "./panels/bandsummary.js";
import { DXSpots } from "./panels/dxspots.js";
import { showSetup } from "./setup.js";
import { QSOPanel } from "./panels/qsos.js";

async function main() {
  const cfg: ServerConfig = await fetch("api/config").then((r) => r.json());
  if (!cfg.configured && !cfg.demo) {
    await showSetup(cfg, true); // reloads the page once saved
    return;
  }
  let settings = loadSettings();
  const get = () => settings;

  const store = new SpotStore();
  let solar: Solar | undefined;
  let connected = false;
  let dx: DXSelection | undefined;
  let working: Working | undefined;
  let qsos: QSO[] = [];

  const topbar = new TopBar(document.getElementById("topbar")!, cfg, get);
  const map = createMap(document.getElementById("map")!, cfg, get);
  const dedx = new DeDx(cfg);
  const mySignal = new BandSummary("me", "My signal · who hears me",
    cfg.callsign ? "Nobody has reported you yet. Call CQ on FT8, or check RBN for CW." : 'Set "callsign" in config.json.');
  const heardHere = new BandSummary("here", "Heard here · what I'm decoding",
    "Nothing decoded yet. In WSJT-X: Settings › Reporting › UDP Server 127.0.0.1:2237.");
  let openDrawer: (section?: "dx") => void = () => {};
  const dxSpots = new DXSpots(cfg, get, () => openDrawer("dx"));
  const qsoPanel = new QSOPanel(cfg);

  const side = document.getElementById("side")!;
  const sideItems: [Panel, keyof Settings["show"]][] = [
    [dedx, "dedx"], [qsoPanel, "log"], [mySignal, "mySignal"], [heardHere, "heardHere"], [dxSpots, "dxSpots"],
  ];
  for (const [p] of sideItems) side.append(p.el);

  const applyLayout = () => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--scale", String(settings.scale));
    const p = PRESETS[settings.preset];
    for (const [panel, key] of sideItems) panel.el.hidden = !settings.show[key];
    const anySide = sideItems.some(([, key]) => settings.show[key]);
    const sideVisible = p.side !== "none" && anySide;
    const body = document.getElementById("body")!;
    body.dataset.side = sideVisible ? p.side : "none";
    body.style.setProperty("--side-size", p.size);
    side.hidden = !sideVisible;
    document.querySelector<HTMLElement>("#legend .lg-here")!.hidden = !settings.show.heardHere;
  };
  applyLayout();

  openDrawer = initDrawer(cfg, get, () => showSetup(cfg, false), (s: Settings) => {
    settings = s;
    saveSettings(s);
    applyLayout();
    tick(true);
  });

  connectStream({
    snapshot: (list) => store.replace(list),
    spots: (batch) => store.add(batch),
    solar: (s) => (solar = s),
    working: (w) => {
      // Follow WSJT-X: when you start working a new station, make it the DX.
      if (w.call && w.call !== working?.call && w.lat != null && w.lon != null) {
        dx = { call: w.call, lat: w.lat, lon: w.lon, grid: w.grid };
      }
      working = w;
      tick(true);
    },
    qsos: (q) => {
      qsos = q;
      tick(true);
    },
    status: (ok) => (connected = ok),
  });

  const select = (sel: DXSelection | undefined) => {
    dx = sel;
    tick(true);
  };

  const panels: Panel[] = [topbar, map, ...sideItems.map(([p]) => p)];
  let lastFull = 0;
  const tick = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFull < 1000) return;
    lastFull = now;
    store.prune(now);
    const ctx: UpdateContext = {
      now,
      spots: store.filtered(settings, now, cfg),
      allCount: store.size,
      ratePerMin: store.ratePerMin,
      solar,
      connected,
      dx,
      select,
      // WSJT-X sends status at least every 15 s while running.
      working: working && now - working.updated < 60_000 ? working : undefined,
      qsos,
    };
    for (const p of panels) {
      if (p.el.hidden) continue;
      try {
        p.update(ctx);
      } catch (e) {
        console.error("panel update failed", e);
      }
    }
  };
  setInterval(() => tick(), 250);
  tick(true);
}

main().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:2rem">QTHClock failed to start:\n${e}</pre>`;
});
