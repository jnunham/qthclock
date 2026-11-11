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
    log: boolean;
    arcs: boolean;
    grayline: boolean;
  };
  scale: number;          // text/UI scale multiplier
  theme: Theme;
  globe: boolean;
  maxAgeMin: number;      // hide spots older than this
  sources: Record<string, boolean>;
  dx: DXFilter;           // filters for "DX near you"
}

export interface DXFilter {
  bands: string[];        // empty = all bands
  modes: string[];        // mode groups; empty = all
  hideCountry: boolean;   // hide stations in my own DXCC entity
  hideCont: boolean;      // hide stations on my continent
}

export const PRESETS: Record<Preset, { label: string; side: "right" | "bottom" | "none"; size: string }> = {
  balanced: { label: "Balanced", side: "right", size: "32rem" },
  map: { label: "Map only", side: "none", size: "0" },
  spots: { label: "Lists focus", side: "right", size: "48%" },
  wall: { label: "Wall / TV", side: "bottom", size: "36%" },
};

export const DEFAULTS: Settings = {
  preset: "balanced",
  show: { clock: true, solar: true, dedx: true, mySignal: true, heardHere: false, dxSpots: true, log: true, arcs: true, grayline: true },
  scale: 1,
  theme: "dark",
  globe: false,
  maxAgeMin: 15,
  sources: { pskr: true, wsjtx: true, rbn: true, cluster: true, demo: true },
  dx: { bands: [], modes: [], hideCountry: true, hideCont: false },
};

const KEY = "qthclock.settings.v2";

export function loadSettings(): Settings {
  let s: Settings = structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      s = { ...s, ...saved, show: { ...s.show, ...saved.show }, sources: { ...s.sources, ...saved.sources }, dx: { ...s.dx, ...saved.dx } };
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
