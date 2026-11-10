export const BANDS = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m"] as const;

const COLORS: Record<string, string> = {
  "160m": "#9b7bff",
  "80m": "#5b8cff",
  "60m": "#3fb8ff",
  "40m": "#24d4c4",
  "30m": "#3ddc84",
  "20m": "#a9e34b",
  "17m": "#ffd43b",
  "15m": "#ffa94d",
  "12m": "#ff6b6b",
  "10m": "#f06595",
  "6m": "#da77f2",
  "2m": "#ced4da",
};

export function bandColor(band: string): string {
  return COLORS[band] ?? "#868e96";
}

export const MODE_GROUPS: Record<string, string[]> = {
  FT8: ["FT8"],
  FT4: ["FT4"],
  CW: ["CW"],
  SSB: ["SSB", "USB", "LSB", "AM", "FM"],
  RTTY: ["RTTY"],
  Other: [],
};

export function modeGroup(mode: string): string {
  const m = mode.toUpperCase();
  for (const [g, list] of Object.entries(MODE_GROUPS)) if (list.includes(m)) return g;
  return "Other";
}
