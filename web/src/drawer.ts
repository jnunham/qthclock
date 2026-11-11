import { PRESETS, THEMES, type Preset, type Settings, type Theme } from "./settings.js";
import type { ServerConfig } from "./types.js";

/**
 * The settings drawer. Kept to one short screen: layout, panels, text size,
 * theme and map. Anything more belongs in config.json.
 * Returns a function that opens the drawer.
 */
export function initDrawer(
  cfg: ServerConfig,
  get: () => Settings,
  editStation: () => void,
  set: (s: Settings) => void,
): () => void {
  const gear = document.getElementById("gear")!;
  const drawer = document.getElementById("drawer")!;

  const render = () => {
    const s = get();
    const checkbox = (key: keyof Settings["show"], label: string) =>
      `<label class="check"><input type="checkbox" data-show="${key}" ${s.show[key] ? "checked" : ""}> ${label}</label>`;
    drawer.innerHTML = `
      <div class="drawer-head"><h2>Settings <span class="muted small">apply to every screen</span></h2><button class="close" aria-label="Close">✕</button></div>
      <button class="station">Station: <b>${cfg.callsign}</b> ${cfg.grid} · change…</button>

      <h3>Layout</h3>
      <div class="seg">${Object.entries(PRESETS).map(([k, p]) =>
        `<button data-preset="${k}" class="${s.preset === k ? "on" : ""}">${p.label}</button>`).join("")}</div>

      <h3>Panels</h3>
      <div class="checks">
        ${checkbox("clock", "Clock")}${checkbox("space", "Space weather")}
        ${checkbox("dedx", "DE / DX")}${checkbox("mySignal", "My signal")}
        ${checkbox("openings", "Bands open")}${checkbox("log", "QSOs")}
        ${checkbox("arcs", "Lines to stations hearing me")}
        ${checkbox("grayline", "Gray line")}${checkbox("solar", "Solar numbers in top bar")}
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

      <h3>Distances</h3>
      <div class="seg">
        <button data-units="mi" class="${s.units === "mi" ? "on" : ""}">Miles</button>
        <button data-units="km" class="${s.units === "km" ? "on" : ""}">Kilometres</button>
      </div>

      <h3>Text size <span class="muted" data-scale-label>${Math.round(s.scale * 100)}%</span></h3>
      <input type="range" min="0.7" max="2.5" step="0.05" value="${s.scale}" data-scale>

      <h3>Theme</h3>
      <div class="seg">${THEMES.map((t) =>
        `<button data-theme="${t.id}" class="${s.theme === t.id ? "on" : ""}">${t.label}</button>`).join("")}</div>

      <h3>Keep spots for</h3>
      <select data-age>${[5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${s.maxAgeMin === m ? "selected" : ""}>${m} minutes</option>`).join("")}</select>

      <h3>On air</h3>
      <label class="check"><input type="checkbox" data-follow ${s.followRadio ? "checked" : ""}> Follow my spots: highlight the band I'm being heard on and fade other bands on the map</label>

      <h3>Sources</h3>
      <div class="checks">${Object.keys(s.sources).filter((k) => k !== "demo" || cfg.demo).map((k) =>
        `<label class="check"><input type="checkbox" data-src="${k}" ${s.sources[k] ? "checked" : ""}> ${srcName(k)}</label>`).join("")}</div>
    `;
  };


  drawer.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const s = structuredClone(get());
    if (t.closest(".close")) { drawer.hidden = true; return; }
    if (t.closest(".station")) { drawer.hidden = true; editStation(); return; }
    if (t.dataset.preset) s.preset = t.dataset.preset as Preset;
    else if (t.dataset.theme) s.theme = t.dataset.theme as Theme;
    else if (t.dataset.units) s.units = t.dataset.units as "mi" | "km";
    else if (t.dataset.mapzoom) {
      const z = t.dataset.mapzoom;
      s.map.zoom = z === "world" ? 0 : Math.max(0, Math.min(4, s.map.zoom + (z === "in" ? 0.5 : -0.5)));
    } else if (t.dataset.mapcenter) s.map.center = t.dataset.mapcenter as "home" | "world";
    else return;
    set(s);
    keepScroll(render);
  });

  drawer.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const s = structuredClone(get());
    if (t.dataset.show) s.show[t.dataset.show as keyof Settings["show"]] = t.checked;
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

  const open = () => {
    drawer.hidden = false;
    render();
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

function srcName(k: string): string {
  return ({ pskr: "PSK Reporter", rbn: "RBN", cluster: "DX cluster", demo: "Demo" } as Record<string, string>)[k] ?? k;
}
