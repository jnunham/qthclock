import { BANDS, MODE_GROUPS, bandColor } from "./bands.js";
import { PRESETS, type Preset, type Settings, type Theme } from "./settings.js";
import type { ServerConfig } from "./types.js";

/**
 * The settings drawer. Kept to one short screen: layout, panels, text size,
 * theme and the "DX near you" filters. Anything more belongs in config.json.
 * Returns a function that opens the drawer, optionally at the DX section.
 */
export function initDrawer(
  cfg: ServerConfig,
  get: () => Settings,
  editStation: () => void,
  set: (s: Settings) => void,
): (section?: "dx") => void {
  const gear = document.getElementById("gear")!;
  const drawer = document.getElementById("drawer")!;

  const render = () => {
    const s = get();
    const checkbox = (key: keyof Settings["show"], label: string) =>
      `<label class="check"><input type="checkbox" data-show="${key}" ${s.show[key] ? "checked" : ""}> ${label}</label>`;
    const dxCheck = (key: "hideCountry" | "hideCont", label: string) =>
      `<label class="check"><input type="checkbox" data-dx="${key}" ${s.dx[key] ? "checked" : ""}> ${label}</label>`;
    drawer.innerHTML = `
      <div class="drawer-head"><h2>Settings <span class="muted small">apply to every screen</span></h2><button class="close" aria-label="Close">✕</button></div>
      <button class="station">Station: <b>${cfg.callsign}</b> ${cfg.grid} · change…</button>

      <h3>Layout</h3>
      <div class="seg">${Object.entries(PRESETS).map(([k, p]) =>
        `<button data-preset="${k}" class="${s.preset === k ? "on" : ""}">${p.label}</button>`).join("")}</div>

      <h3>Panels</h3>
      <div class="checks">
        ${checkbox("clock", "Clock")}${checkbox("solar", "Solar")}
        ${checkbox("dedx", "DE / DX")}${checkbox("mySignal", "My signal")}
        ${checkbox("dxSpots", "DX near me")}${checkbox("log", "QSOs")}
        ${checkbox("heardHere", "Heard here (what I decode)")}${checkbox("arcs", "Path lines")}
        ${checkbox("grayline", "Gray line")}
        <label class="check"><input type="checkbox" data-globe ${s.globe ? "checked" : ""}> Globe view</label>
      </div>

      <h3>Map zoom <span class="muted">${s.map.zoom === 0 ? "whole world" : `+${s.map.zoom}`}</span></h3>
      <div class="seg">
        <button data-mapzoom="out">− Out</button>
        <button data-mapzoom="world" class="${s.map.zoom === 0 ? "on" : ""}">Whole world</button>
        <button data-mapzoom="in">In +</button>
      </div>
      <div class="seg" style="margin-top:0.3rem">
        <button data-mapcenter="home" class="${s.map.center === "home" ? "on" : ""}">Centre on my QTH</button>
        <button data-mapcenter="world" class="${s.map.center === "world" ? "on" : ""}">Centre on world</button>
      </div>

      <h3>Text size <span class="muted" data-scale-label>${Math.round(s.scale * 100)}%</span></h3>
      <input type="range" min="0.7" max="2.5" step="0.05" value="${s.scale}" data-scale>

      <h3>Theme</h3>
      <div class="seg">${(["dark", "night", "light"] as Theme[]).map((t) =>
        `<button data-theme="${t}" class="${s.theme === t ? "on" : ""}">${t === "night" ? "Night (red)" : t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>

      <h3>Keep spots for</h3>
      <select data-age>${[5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${s.maxAgeMin === m ? "selected" : ""}>${m} minutes</option>`).join("")}</select>

      <h3>Radio</h3>
      <label class="check"><input type="checkbox" data-follow ${s.followRadio ? "checked" : ""}> Follow WSJT-X: show DX on my current band and mode, fade other bands on the map</label>

      <h3 id="dx-filters">DX near me <span class="muted">${s.followRadio ? "(used when the radio is idle)" : ""}</span></h3>
      <div class="chips">${Object.keys(MODE_GROUPS).map((m) =>
        `<button data-mode="${m}" class="chip ${s.dx.modes.includes(m) ? "on" : ""}">${m}</button>`).join("")}</div>
      <div class="chips">${BANDS.map((b) =>
        `<button data-band="${b}" class="chip ${s.dx.bands.includes(b) ? "on" : ""}" style="--c:${bandColor(b)}">${b}</button>`).join("")}</div>
      <p class="muted small">Pick the modes and bands you're working. Nothing selected means all of them.</p>
      <div class="checks">
        ${dxCheck("hideCountry", `Hide ${cfg.country ?? "my country"}`)}
        ${dxCheck("hideCont", `Hide ${cfg.cont ? contName(cfg.cont) : "my continent"}`)}
      </div>

      <h3>Sources</h3>
      <div class="checks">${Object.keys(s.sources).filter((k) => k !== "demo" || cfg.demo).map((k) =>
        `<label class="check"><input type="checkbox" data-src="${k}" ${s.sources[k] ? "checked" : ""}> ${srcName(k)}</label>`).join("")}</div>
    `;
  };

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  drawer.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const s = structuredClone(get());
    if (t.closest(".close")) { drawer.hidden = true; return; }
    if (t.closest(".station")) { drawer.hidden = true; editStation(); return; }
    if (t.dataset.preset) s.preset = t.dataset.preset as Preset;
    else if (t.dataset.theme) s.theme = t.dataset.theme as Theme;
    else if (t.dataset.mapzoom) {
      const z = t.dataset.mapzoom;
      s.map.zoom = z === "world" ? 0 : Math.max(0, Math.min(4, s.map.zoom + (z === "in" ? 0.5 : -0.5)));
    } else if (t.dataset.mapcenter) s.map.center = t.dataset.mapcenter as "home" | "world";
    else if (t.dataset.band) s.dx.bands = toggle(s.dx.bands, t.dataset.band);
    else if (t.dataset.mode) s.dx.modes = toggle(s.dx.modes, t.dataset.mode);
    else return;
    set(s);
    keepScroll(render);
  });

  drawer.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const s = structuredClone(get());
    if (t.dataset.show) s.show[t.dataset.show as keyof Settings["show"]] = t.checked;
    else if (t.dataset.dx) s.dx[t.dataset.dx as "hideCountry" | "hideCont"] = t.checked;
    else if ("globe" in t.dataset) s.globe = t.checked;
    else if ("follow" in t.dataset) { s.followRadio = t.checked; set(s); keepScroll(render); return; }
    else if (t.dataset.src) s.sources[t.dataset.src] = t.checked;
    else if ("age" in t.dataset) s.maxAgeMin = Number(t.value);
    else if ("scale" in t.dataset) {
      s.scale = Number(t.value);
      drawer.querySelector("[data-scale-label]")!.textContent = `${Math.round(s.scale * 100)}%`;
    } else return;
    set(s);
  });

  const keepScroll = (fn: () => void) => {
    const top = drawer.scrollTop;
    fn();
    drawer.scrollTop = top;
  };

  const open = (section?: "dx") => {
    drawer.hidden = false;
    render();
    if (section === "dx") drawer.querySelector("#dx-filters")?.scrollIntoView({ block: "start" });
  };
  gear.addEventListener("click", () => (drawer.hidden ? open() : (drawer.hidden = true)));

  // Kiosk-friendly: the gear fades out when the mouse is idle.
  let idle: number | undefined;
  const wake = () => {
    document.body.classList.remove("idle");
    clearTimeout(idle);
    idle = window.setTimeout(() => document.body.classList.add("idle"), 4000);
  };
  window.addEventListener("pointermove", wake);
  window.addEventListener("keydown", (e) => {
    wake();
    if (e.key === "Escape") drawer.hidden = true;
    if (e.key === "s" && !(e.target instanceof HTMLInputElement)) gear.click();
  });
  wake();
  return open;
}

function contName(c: string): string {
  return ({ NA: "North America", SA: "South America", EU: "Europe", AF: "Africa", AS: "Asia", OC: "Oceania", AN: "Antarctica" } as Record<string, string>)[c] ?? c;
}

function srcName(k: string): string {
  return ({ pskr: "PSK Reporter", wsjtx: "WSJT-X", rbn: "RBN", cluster: "DX cluster", demo: "Demo" } as Record<string, string>)[k] ?? k;
}
