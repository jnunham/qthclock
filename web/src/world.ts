// Loads the map outlines the server builds from Natural Earth 1:50m
// (public domain): land, lakes, country borders and state/province lines.
// Coordinates arrive as integer hundredths of a degree in flat lists.

export type Line = Float32Array; // lon,lat,lon,lat,...

export interface World {
  land: Line[][];   // polygons (outer ring, then holes)
  lakes: Line[][];
  borders: Line[];  // land borders between countries
  states: Line[];   // state/province lines (US, Canada, Australia, Brazil)
}

interface Packed { v: number; land: number[][][]; lakes: number[][][]; borders: number[][]; states: number[][] }

let cached: Promise<World | undefined> | undefined;

export function loadWorld(): Promise<World | undefined> {
  cached ??= fetch("api/world")
    .then((r) => (r.ok ? r.json() : undefined))
    .then((p) => (p && (p as Packed).v ? unpack(p as Packed) : undefined))
    .catch(() => undefined);
  return cached;
}

export function unpack(p: Packed): World {
  const line = (a: number[]) => Float32Array.from(a, (v) => v / 100);
  return {
    land: (p.land ?? []).map((poly) => poly.map(line)),
    lakes: (p.lakes ?? []).map((poly) => poly.map(line)),
    borders: (p.borders ?? []).map(line),
    states: (p.states ?? []).map(line),
  };
}
