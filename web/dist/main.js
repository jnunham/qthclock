import { fetchSettings, mergeSettings, saveSettings, urlOverrides, PRESETS } from "./settings.js";
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
/** A station you click stays the DX this long before automatic selection resumes. */
const MANUAL_HOLD_MS = 3 * 60_000;
/** Automatic DX is re-evaluated at most this often, so it doesn't flicker. */
const AUTO_DX_MS = 30_000;
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
    let working;
    let qsos = [];
    // DX selection: working station > recent click > automatic pick.
    let manual;
    let auto = { at: 0 };
    let workingSel;
    const topbar = new TopBar(document.getElementById("topbar"), cfg, get);
    const map = createMap(document.getElementById("map"), cfg, get);
    const dedx = new DeDx(cfg);
    const mySignal = new BandSummary("me", "My signal · who hears me", cfg.callsign ? "Nobody has reported you yet. Call CQ on FT8, or check RBN for CW." : 'Set "callsign" in config.json.');
    const heardHere = new BandSummary("here", "Heard here · what I'm decoding", "Nothing decoded yet. In WSJT-X: Settings › Reporting › UDP Server 127.0.0.1:2237.");
    let openDrawer = () => { };
    const dxSpots = new DXSpots(cfg, get, () => openDrawer("dx"));
    const qsoPanel = new QSOPanel(cfg);
    const side = document.getElementById("side");
    const sideItems = [
        [dedx, "dedx"], [qsoPanel, "log"], [mySignal, "mySignal"], [heardHere, "heardHere"], [dxSpots, "dxSpots"],
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
        document.querySelector("#legend .lg-here").hidden = !settings.show.heardHere;
    };
    applyLayout();
    const applyShared = (s) => {
        shared = s;
        settings = { ...shared, ...overrides };
        applyLayout();
        tick(true);
    };
    openDrawer = initDrawer(cfg, get, () => showSetup(cfg, false), (s) => {
        // This screen's URL overrides stay on this screen; everything else is shared.
        const toSave = { ...s };
        for (const k of Object.keys(overrides))
            toSave[k] = shared[k];
        applyShared(toSave);
        saveSettings(toSave);
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
            if (!w.call)
                workingSel = undefined;
            working = w;
            tick(true);
        },
        qsos: (q) => {
            qsos = q;
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
        if (!sel)
            auto = { at: 0 };
        tick(true);
    };
    /** Farthest station hearing me, on the active band when following the radio. */
    const pickAuto = (spots, band) => {
        let best;
        for (const s of spots) {
            if (s.rel !== "me" || s.dela == null || s.delo == null || s.km == null)
                continue;
            if (band && s.b !== band)
                continue;
            if (!best || s.km > best.km)
                best = s;
        }
        return best ? { call: best.de, lat: best.dela, lon: best.delo, grid: best.deg, spot: best, reason: "auto" } : undefined;
    };
    const panels = [topbar, map, ...sideItems.map(([p]) => p)];
    let lastFull = 0;
    const tick = (force = false) => {
        const now = Date.now();
        if (!force && now - lastFull < 1000)
            return;
        lastFull = now;
        store.prune(now);
        // WSJT-X sends status at least every 15 s while it's running.
        const radio = working && now - working.updated < 60_000 ? working : undefined;
        const active = settings.followRadio && radio?.b ? { band: radio.b, mode: radio.m } : undefined;
        const spots = store.filtered(settings, now, cfg, active);
        if (manual && now - manual.at > MANUAL_HOLD_MS)
            manual = undefined;
        if (now - auto.at > AUTO_DX_MS || auto.band !== active?.band) {
            auto = { sel: pickAuto(spots, active?.band), at: now, band: active?.band };
        }
        const dx = (radio && workingSel) || manual?.sel || auto.sel;
        const ctx = {
            now, spots, allCount: store.size, ratePerMin: store.ratePerMin,
            solar, connected, dx, select,
            working: radio, qsos, active,
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
main().catch((e) => {
    document.body.innerHTML = `<pre style="color:#f88;padding:2rem">QTHClock failed to start:\n${e}</pre>`;
});
//# sourceMappingURL=main.js.map