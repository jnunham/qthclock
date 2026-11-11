// User settings live in localStorage so each display (shack PC, wall TV,
// tablet) can have its own layout while sharing one server.
export const THEMES = [
    { id: "dark", label: "Dark" }, { id: "ocean", label: "Ocean" }, { id: "slate", label: "Slate" },
    { id: "amber", label: "Amber" }, { id: "phosphor", label: "Phosphor" }, { id: "night", label: "Night (red)" },
    { id: "light", label: "Light" },
];
export const PRESETS = {
    balanced: { label: "Balanced", side: "right", size: "32rem" },
    map: { label: "Map only", side: "none", size: "0" },
    spots: { label: "Lists focus", side: "right", size: "48%" },
    wall: { label: "Wall / TV", side: "bottom", size: "32%" },
};
export const DEFAULTS = {
    preset: "balanced",
    show: { clock: true, solar: true, dedx: true, mySignal: true, openings: true, log: true, arcs: true, grayline: true },
    scale: 1,
    theme: "dark",
    maxAgeMin: 15,
    sources: { pskr: true, rbn: true, cluster: true, demo: true },
    followRadio: true,
    map: { zoom: 0, center: "home" },
};
/** Fill in anything missing from saved settings with defaults. */
export function mergeSettings(saved) {
    const d = structuredClone(DEFAULTS);
    if (!saved || typeof saved !== "object")
        return d;
    return {
        ...d, ...saved,
        show: { ...d.show, ...saved.show },
        sources: Object.fromEntries(Object.keys(d.sources).map((k) => [k, saved.sources?.[k] ?? d.sources[k]])),
        map: { ...d.map, ...saved.map },
    };
}
export function urlOverrides() {
    const q = new URLSearchParams(location.search);
    const o = {};
    const preset = q.get("preset");
    if (preset && preset in PRESETS)
        o.preset = preset;
    if (q.get("scale"))
        o.scale = Number(q.get("scale")) || 1;
    const theme = q.get("theme");
    if (theme && THEMES.some((t) => t.id === theme))
        o.theme = theme;
    return o;
}
export async function fetchSettings() {
    try {
        return mergeSettings(await fetch("api/settings").then((r) => r.json()));
    }
    catch {
        return mergeSettings(null);
    }
}
export async function saveSettings(s) {
    try {
        await fetch("api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    }
    catch {
        /* server unreachable: the change still applies on this screen */
    }
}
//# sourceMappingURL=settings.js.map