// User settings live in localStorage so each display (shack PC, wall TV,
// tablet) can have its own layout while sharing one server.

export type Preset = "balanced" | "map" | "spots" | "wall";
export type Theme = "dark" | "night" | "light";

export interface Settings {
  preset: Preset;
  show: {
    clock: boolean;
    solar: boolean;
    dedx: boolean;
    mySignal: boolean;
    heardHere: boolean;
    dxSpots: boolean;
    arcs: boolean;
    grayline: boolean;
  };
  scale: number;          // text/UI scale multiplier
  theme: Theme;
  globe: boolean;
  maxAgeMin: number;      // hide spots older than this
  bands: string[];        // empty = all bands
  modes: string[];        // mode groups; empty = all
  sources: Record<string, boolean>;
}

export const PRESETS: Record<Preset, { label: string; side: "right" | "bottom" | "none"; size: string }> = {
  balanced: { label: "Balanced", side: "right", size: "32rem" },
  map: { label: "Map only", side: "none", size: "0" },
  spots: { label: "Lists focus", side: "right", size: "48%" },
  wall: { label: "Wall / TV", side: "bottom", size: "36%" },
};

export const DEFAULTS: Settings = {
  preset: "balanced",
  show: { clock: true, solar: true, dedx: true, mySignal: true, heardHere: true, dxSpots: true, arcs: true, grayline: true },
  scale: 1,
  theme: "dark",
  globe: false,
  maxAgeMin: 15,
  bands: [],
  modes: [],
  sources: { pskr: true, wsjtx: true, rbn: true, cluster: true, demo: true },
};

const KEY = "qthclock.settings.v1";

export function loadSettings(): Settings {
  let s: Settings = structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      s = { ...s, ...saved, show: { ...s.show, ...saved.show }, sources: { ...s.sources, ...saved.sources } };
    }
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  // URL overrides make kiosk setups easy: /?preset=wall&scale=1.5&theme=night
  const q = new URLSearchParams(location.search);
  if (q.get("preset") && q.get("preset")! in PRESETS) s.preset = q.get("preset") as Preset;
  if (q.get("scale")) s.scale = Number(q.get("scale")) || 1;
  if (q.get("theme")) s.theme = q.get("theme") as Theme;
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
