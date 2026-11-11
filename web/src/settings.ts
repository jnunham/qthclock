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
  followRadio: boolean;   // follow WSJT-X's band and mode automatically
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
  followRadio: true,
};

/** Fill in anything missing from saved settings with defaults. */
export function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const d = structuredClone(DEFAULTS);
  if (!saved || typeof saved !== "object") return d;
  return {
    ...d, ...saved,
    show: { ...d.show, ...saved.show },
    sources: { ...d.sources, ...saved.sources },
    dx: { ...d.dx, ...saved.dx },
  };
}

/**
 * Settings are shared through the server, so a phone or laptop can change
 * what the wall monitor shows. URL parameters override them for one screen
 * only, e.g. /?preset=wall&scale=1.5&theme=night on the monitor itself.
 */
type Override = Partial<Pick<Settings, "preset" | "scale" | "theme">>;

export function urlOverrides(): Override {
  const q = new URLSearchParams(location.search);
  const o: Override = {};
  const preset = q.get("preset");
  if (preset && preset in PRESETS) o.preset = preset as Preset;
  if (q.get("scale")) o.scale = Number(q.get("scale")) || 1;
  const theme = q.get("theme");
  if (theme === "dark" || theme === "night" || theme === "light") o.theme = theme;
  return o;
}

export async function fetchSettings(): Promise<Settings> {
  try {
    return mergeSettings(await fetch("api/settings").then((r) => r.json()));
  } catch {
    return mergeSettings(null);
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    await fetch("api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
  } catch {
    /* server unreachable: the change still applies on this screen */
  }
}
