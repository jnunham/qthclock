import type { DXSelection, Panel, QSO, ServerConfig, Solar, UpdateContext, Working, WSJTXInfo } from "./types.js";
import { fetchSettings, mergeSettings, saveSettings, urlOverrides, PRESETS, type Settings } from "./settings.js";
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

/** A station you click stays the DX this long, then the display goes back to your QSO partner. */
const MANUAL_HOLD_MS = 3 * 60_000;

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
  let working: Working | undefined;
  let qsos: QSO[] = [];
  let wavelog: UpdateContext["wavelog"];
  let wsjtx: WSJTXInfo | undefined;

  // DX selection: the station you're working > a recent click > your last QSO partner.
  let manual: { sel: DXSelection; at: number } | undefined;
  let workingSel: DXSelection | undefined;
  let lastSel: DXSelection | undefined;

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
    const p = PRESETS[settings.preset] ?? PRESETS.balanced;
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

  const applyShared = (s: Settings) => {
    shared = s;
    settings = { ...shared, ...overrides };
    applyLayout();
    tick(true);
  };

  openDrawer = initDrawer(cfg, get, () => showSetup(cfg, false), (s: Settings) => {
    // This screen's URL overrides stay on this screen; everything else is shared.
    const toSave = { ...s } as Record<string, unknown>;
    for (const k of Object.keys(overrides)) toSave[k] = (shared as unknown as Record<string, unknown>)[k];
    applyShared(toSave as unknown as Settings);
    saveSettings(toSave as unknown as Settings);
  });

  connectStream({
    snapshot: (list) => store.replace(list),
    spots: (batch) => store.add(batch),
    solar: (s) => (solar = s),
    working: (w) => {
      if (w.call && w.call !== working?.call && w.lat != null && w.lon != null) {
        workingSel = { call: w.call, lat: w.lat, lon: w.lon, grid: w.grid, reason: "working" };
        manual = undefined; // a new QSO takes over from whatever was clicked
      }
      w.updated = Date.now(); // use this screen's clock, in case the Pi's and this device's clocks differ
      if (!w.call && workingSel) {
        lastSel = { ...workingSel, reason: "last" };
        workingSel = undefined;
      }
      working = w;
      tick(true);
    },
    qsos: (q) => {
      qsos = q;
      tick(true);
    },
    wsjtx: (i) => {
      wsjtx = i;
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
    if (!sel) lastSel = undefined;
    tick(true);
  };

  const panels: Panel[] = [topbar, map, ...sideItems.map(([p]) => p)];
  let lastFull = 0;
  const tick = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFull < 1000) return;
    lastFull = now;
    store.prune(now);

    // WSJT-X sends status at least every 15 s while it's running.
    const radio = working && now - working.updated < 60_000 ? working : undefined;
    const active = settings.followRadio && radio?.b ? { band: radio.b, mode: radio.m } : undefined;
    const spots = store.filtered(settings, now, cfg, active);

    if (manual && now - manual.at > MANUAL_HOLD_MS) manual = undefined;
    const dx = (radio && workingSel) || manual?.sel || lastSel;

    const ctx: UpdateContext = {
      now, spots, allCount: store.size, ratePerMin: store.ratePerMin,
      solar, connected, dx, select,
      working: radio, qsos, active, wavelog, wsjtx,
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
