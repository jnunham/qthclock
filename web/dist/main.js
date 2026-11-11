import { fetchSettings, mergeSettings, saveSettings, urlOverrides, PRESETS } from "./settings.js";
import { SpotStore } from "./store.js";
import { connectStream } from "./stream.js";
import { initDrawer } from "./drawer.js";
import { TopBar } from "./panels/topbar.js";
import { WorldMap, MAX_ZOOM_STEPS } from "./panels/map.js";
import { DeDx } from "./panels/dedx.js";
import { BandSummary } from "./panels/bandsummary.js";
import { DXSpots } from "./panels/dxspots.js";
import { showSetup } from "./setup.js";
import { QSOPanel } from "./panels/qsos.js";
import { modeGroup } from "./bands.js";
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
function onAirFrom(spots, now) {
    const score = new Map();
    for (const s of spots) {
        if (s.rel !== "me" || !s.b || now - s.t > ON_AIR_MS)
            continue;
        const mode = modeGroup(s.m);
        const key = s.b + "|" + mode;
        const e = score.get(key) ?? { band: s.b, mode, w: 0, last: 0, count: 0 };
        e.w += now - s.t < ON_AIR_MS / 2 ? 1 : 1 / 3;
        e.last = Math.max(e.last, s.t);
        e.count++;
        score.set(key, e);
    }
    let best;
    for (const e of score.values())
        if (!best || e.w > best.w)
            best = e;
    return best && { band: best.band, mode: best.mode, last: best.last, count: best.count };
}
async function main() {
    const cfg = await fetch("api/config").then((r) => r.json());
    if (!cfg.configured && !cfg.demo) {
        await showSetup(cfg, true); // reloads the page once saved
        return;
    }
    // Shared settings (from the server) + this screen's URL overrides.
    const overrides = urlOverrides();
    let shared = await fetchSettings();
    let settings = { ...shared, ...overrides };
    const get = () => settings;
    const store = new SpotStore();
    let solar;
    let connected = false;
    let qsos = [];
    let wavelog;
    let manual;
    const topbar = new TopBar(document.getElementById("topbar"), cfg, get);
    const map = new WorldMap(document.getElementById("map"), cfg, get);
    const dedx = new DeDx(cfg);
    const mySignal = new BandSummary("me", "My signal · who hears me", cfg.callsign ? "Nobody has reported you yet. Call CQ on FT8, or check RBN for CW." : 'Set "callsign" in config.json.');
    let openDrawer = () => { };
    const dxSpots = new DXSpots(cfg, get, () => openDrawer("dx"));
    const qsoPanel = new QSOPanel(cfg);
    const side = document.getElementById("side");
    const sideItems = [
        [dedx, "dedx"], [qsoPanel, "log"], [mySignal, "mySignal"], [dxSpots, "dxSpots"],
    ];
    for (const [p] of sideItems)
        side.append(p.el);
    const applyLayout = () => {
        const root = document.documentElement;
        root.dataset.theme = settings.theme;
        root.style.setProperty("--scale", String(settings.scale));
        const p = PRESETS[settings.preset] ?? PRESETS.balanced;
        for (const [panel, key] of sideItems)
            panel.el.hidden = !settings.show[key];
        const anySide = sideItems.some(([, key]) => settings.show[key]);
        const sideVisible = p.side !== "none" && anySide;
        const body = document.getElementById("body");
        body.dataset.side = sideVisible ? p.side : "none";
        body.style.setProperty("--side-size", p.size);
        side.hidden = !sideVisible;
    };
    applyLayout();
    const applyShared = (s) => {
        shared = s;
        settings = { ...shared, ...overrides };
        applyLayout();
        tick(true);
    };
    /** Save a settings change: shared with every screen, except this screen's URL overrides. */
    const commit = (s) => {
        const toSave = { ...s };
        for (const k of Object.keys(overrides))
            toSave[k] = shared[k];
        applyShared(toSave);
        saveSettings(toSave);
    };
    openDrawer = initDrawer(cfg, get, () => showSetup(cfg, false), commit);
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
            if (JSON.stringify(s) !== JSON.stringify(shared))
                applyShared(mergeSettings(s));
        },
        status: async (ok) => {
            connected = ok;
            // Hands-off updates: if the server restarted (e.g. after a git pull),
            // reload so the monitor runs the new version without anyone touching it.
            if (ok) {
                const now = await fetch("api/config").then((r) => r.json()).catch(() => undefined);
                if (now && now.boot !== cfg.boot)
                    location.reload();
            }
        },
    });
    const select = (sel) => {
        manual = sel ? { sel: { ...sel, reason: "manual" }, at: Date.now() } : undefined;
        tick(true);
    };
    const panels = [topbar, map, ...sideItems.map(([p]) => p)];
    let lastFull = 0;
    const tick = (force = false) => {
        const now = Date.now();
        if (!force && now - lastFull < 1000)
            return;
        lastFull = now;
        store.prune(now);
        // Band/mode you're on, from your own spots; the display follows it.
        const recent = store.filtered({ ...settings, maxAgeMin: Math.max(settings.maxAgeMin, 10) }, now, cfg);
        const onAir = onAirFrom(recent, now);
        const active = settings.followRadio && onAir ? { band: onAir.band, mode: onAir.mode } : undefined;
        const spots = store.filtered(settings, now, cfg, active);
        // DX: a station you clicked (for a few minutes), else your last QSO.
        if (manual && now - manual.at > MANUAL_HOLD_MS)
            manual = undefined;
        const q = qsos[0];
        const last = q && q.lat != null && q.lon != null && now - q.t < LAST_QSO_MS
            ? { call: q.call, lat: q.lat, lon: q.lon, grid: q.grid, reason: "last" }
            : undefined;
        const dx = manual?.sel || last;
        const ctx = {
            now, spots, allCount: store.size, ratePerMin: store.ratePerMin,
            solar, connected, dx, select, qsos, wavelog, onAir, active,
        };
        for (const p of panels) {
            if (p.el.hidden)
                continue;
            try {
                p.update(ctx);
            }
            catch (e) {
                console.error("panel update failed", e);
            }
        }
    };
    setInterval(() => tick(), 250);
    tick(true);
}
/** Zoom buttons on the map. They fade out with the mouse, like the gear. */
function initMapControls(get, commit) {
    const box = document.createElement("div");
    box.id = "mapctl";
    box.innerHTML = `
    <button data-z="in" title="Zoom in">+</button>
    <button data-z="out" title="Zoom out">−</button>
    <button data-z="world" title="Whole world">⌂</button>`;
    document.getElementById("map-wrap").append(box);
    box.addEventListener("click", (e) => {
        const z = e.target.dataset.z;
        if (!z)
            return;
        const s = structuredClone(get());
        if (z === "in")
            s.map.zoom = Math.min(MAX_ZOOM_STEPS, s.map.zoom + 0.5);
        if (z === "out")
            s.map.zoom = Math.max(0, s.map.zoom - 0.5);
        if (z === "world")
            s.map.zoom = 0;
        commit(s);
    });
}
main().catch((e) => {
    document.body.innerHTML = `<pre style="color:#f88;padding:2rem">QTHClock failed to start:\n${e}</pre>`;
});
//# sourceMappingURL=main.js.map