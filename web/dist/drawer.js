import { BANDS, MODE_GROUPS, bandColor } from "./bands.js";
import { PRESETS } from "./settings.js";
/**
 * The settings drawer. Kept to one short screen on purpose: layout, what to
 * show, text size, and spot filters. Anything more belongs in config.json.
 */
export function initDrawer(get, editStation, set) {
    const gear = document.getElementById("gear");
    const drawer = document.getElementById("drawer");
    const render = () => {
        const s = get();
        const checkbox = (key, label) => `<label class="check"><input type="checkbox" data-show="${key}" ${s.show[key] ? "checked" : ""}> ${label}</label>`;
        drawer.innerHTML = `
      <div class="drawer-head"><h2>Display</h2><button class="close" aria-label="Close">✕</button></div>
      <button class="station">Change callsign / grid…</button>

      <h3>Layout</h3>
      <div class="seg">${Object.entries(PRESETS).map(([k, p]) => `<button data-preset="${k}" class="${s.preset === k ? "on" : ""}">${p.label}</button>`).join("")}</div>

      <h3>Show</h3>
      <div class="checks">
        ${checkbox("clock", "Clock")}${checkbox("solar", "Solar")}
        ${checkbox("dedx", "DE / DX")}${checkbox("mySignal", "My signal")}
        ${checkbox("heardHere", "Heard here")}${checkbox("dxSpots", "DX near me")}
        ${checkbox("arcs", "Path lines")}${checkbox("grayline", "Gray line")}
        <label class="check"><input type="checkbox" data-globe ${s.globe ? "checked" : ""}> Globe view</label>
      </div>

      <h3>Text size <span class="muted" data-scale-label>${Math.round(s.scale * 100)}%</span></h3>
      <input type="range" min="0.7" max="2.5" step="0.05" value="${s.scale}" data-scale>

      <h3>Theme</h3>
      <div class="seg">${["dark", "night", "light"].map((t) => `<button data-theme="${t}" class="${s.theme === t ? "on" : ""}">${t === "night" ? "Night (red)" : t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>

      <h3>Spots</h3>
      <div class="row">
        <label>Keep for
          <select data-age>${[5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${s.maxAgeMin === m ? "selected" : ""}>${m} min</option>`).join("")}</select>
        </label>
      </div>
      <div class="chips" data-group="bands">${BANDS.map((b) => `<button data-band="${b}" class="chip ${s.bands.includes(b) ? "on" : ""}" style="--c:${bandColor(b)}">${b}</button>`).join("")}</div>
      <div class="chips" data-group="modes">${Object.keys(MODE_GROUPS).map((m) => `<button data-mode="${m}" class="chip ${s.modes.includes(m) ? "on" : ""}">${m}</button>`).join("")}</div>
      <p class="muted small">No bands or modes selected means all of them.</p>
      <div class="checks">${Object.keys(s.sources).map((k) => `<label class="check"><input type="checkbox" data-src="${k}" ${s.sources[k] ? "checked" : ""}> ${k.toUpperCase()}</label>`).join("")}</div>
    `;
    };
    const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    drawer.addEventListener("click", (e) => {
        const t = e.target;
        const s = structuredClone(get());
        if (t.closest(".close")) {
            drawer.hidden = true;
            return;
        }
        if (t.closest(".station")) {
            drawer.hidden = true;
            editStation();
            return;
        }
        if (t.dataset.preset)
            s.preset = t.dataset.preset;
        else if (t.dataset.theme)
            s.theme = t.dataset.theme;
        else if (t.dataset.band)
            s.bands = toggle(s.bands, t.dataset.band);
        else if (t.dataset.mode)
            s.modes = toggle(s.modes, t.dataset.mode);
        else
            return;
        set(s);
        render();
    });
    drawer.addEventListener("input", (e) => {
        const t = e.target;
        const s = structuredClone(get());
        if (t.dataset.show)
            s.show[t.dataset.show] = t.checked;
        else if ("globe" in t.dataset)
            s.globe = t.checked;
        else if (t.dataset.src)
            s.sources[t.dataset.src] = t.checked;
        else if ("age" in t.dataset)
            s.maxAgeMin = Number(t.value);
        else if ("scale" in t.dataset) {
            s.scale = Number(t.value);
            drawer.querySelector("[data-scale-label]").textContent = `${Math.round(s.scale * 100)}%`;
        }
        else
            return;
        set(s);
    });
    gear.addEventListener("click", () => {
        drawer.hidden = !drawer.hidden;
        if (!drawer.hidden)
            render();
    });
    // Kiosk-friendly: the gear fades out when the mouse is idle.
    let idle;
    const wake = () => {
        document.body.classList.remove("idle");
        clearTimeout(idle);
        idle = window.setTimeout(() => document.body.classList.add("idle"), 4000);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", (e) => {
        wake();
        if (e.key === "Escape")
            drawer.hidden = true;
        if (e.key === "s" && !(e.target instanceof HTMLInputElement))
            gear.click();
    });
    wake();
}
//# sourceMappingURL=drawer.js.map