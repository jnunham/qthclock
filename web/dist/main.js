import { loadSettings, saveSettings, PRESETS } from "./settings.js";
import { SpotStore } from "./store.js";
import { connectStream } from "./stream.js";
import { initDrawer } from "./drawer.js";
import { TopBar } from "./panels/topbar.js";
import { createMap } from "./panels/map.js";
import { DeDx } from "./panels/dedx.js";
import { BandSummary } from "./panels/bandsummary.js";
import { DXSpots } from "./panels/dxspots.js";
import { showSetup } from "./setup.js";
async function main() {
    const cfg = await fetch("api/config").then((r) => r.json());
    if (!cfg.configured && !cfg.demo) {
        await showSetup(cfg, true); // reloads the page once saved
        return;
    }
    let settings = loadSettings();
    const get = () => settings;
    const store = new SpotStore();
    let solar;
    let connected = false;
    let dx;
    const topbar = new TopBar(document.getElementById("topbar"), cfg, get);
    const map = createMap(document.getElementById("map"), cfg, get);
    const dedx = new DeDx(cfg);
    const mySignal = new BandSummary("me", "My signal · who hears me", cfg.callsign ? "Nobody has reported you yet. Call CQ on FT8, or check RBN for CW." : 'Set "callsign" in config.json.');
    const heardHere = new BandSummary("here", "Heard here · what I'm decoding", "Nothing decoded yet. In WSJT-X: Settings › Reporting › UDP Server 127.0.0.1:2237.");
    const dxSpots = new DXSpots(cfg);
    const side = document.getElementById("side");
    const sideItems = [[dedx, "dedx"], [mySignal, "mySignal"], [heardHere, "heardHere"], [dxSpots, "dxSpots"]];
    for (const [p] of sideItems)
        side.append(p.el);
    const applyLayout = () => {
        const root = document.documentElement;
        root.dataset.theme = settings.theme;
        root.style.setProperty("--scale", String(settings.scale));
        const p = PRESETS[settings.preset];
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
    initDrawer(get, () => showSetup(cfg, false), (s) => {
        settings = s;
        saveSettings(s);
        applyLayout();
        tick(true);
    });
    connectStream({
        snapshot: (list) => store.replace(list),
        spots: (batch) => store.add(batch),
        solar: (s) => (solar = s),
        status: (ok) => (connected = ok),
    });
    const select = (sel) => {
        dx = sel;
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
        const ctx = {
            now,
            spots: store.filtered(settings, now),
            allCount: store.size,
            ratePerMin: store.ratePerMin,
            solar,
            connected,
            dx,
            select,
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