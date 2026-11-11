// Loads the world outline (Natural Earth via world-atlas, public domain) that
// the server downloads once and serves at /api/world, and decodes TopoJSON
// into plain [lon, lat] rings. No map library or tile server needed.

export type Ring = [number, number][];

export interface World {
  land: Ring[][];     // polygons (outer ring first), for filling
  borders: Ring[];    // every country outline, for stroking
}

interface Topology {
  type: "Topology";
  arcs: [number, number][][];
  transform?: { scale: [number, number]; translate: [number, number] };
  objects: Record<string, { type: string; geometries?: Geometry[] } & Geometry>;
}
interface Geometry {
  type: string;
  arcs?: number[][] | number[][][];
}

let cached: Promise<World | undefined> | undefined;

export function loadWorld(): Promise<World | undefined> {
  cached ??= fetch("api/world")
    .then((r) => (r.ok ? r.json() : undefined))
    .then((t) => (t ? decode(t as Topology) : undefined))
    .catch(() => undefined);
  return cached;
}

/** Decode a TopoJSON topology into polygons. Exported for testing. */
export function decode(topo: Topology): World {
  // 1. Decode arcs (delta-encoded, quantized when there's a transform).
  const arcs: Ring[] = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([a, b]) => {
      if (topo.transform) {
        x += a; y += b;
        return [x * topo.transform.scale[0] + topo.transform.translate[0], y * topo.transform.scale[1] + topo.transform.translate[1]];
      }
      return [a, b];
    }) as Ring;
  });
  // 2. An arc index ~i means arc i reversed. Consecutive arcs share an end point.
  const ring = (ids: number[]): Ring => {
    const out: Ring = [];
    ids.forEach((id, k) => {
      const pts = id >= 0 ? arcs[id] : [...arcs[~id]].reverse();
      out.push(...(k === 0 ? pts : pts.slice(1)));
    });
    return out;
  };
  const polygons = (g: Geometry): Ring[][] => {
    if (g.type === "Polygon") return [(g.arcs as number[][]).map(ring)];
    if (g.type === "MultiPolygon") return (g.arcs as number[][][]).map((p) => p.map(ring));
    return [];
  };
  const geoms = (name: string): Geometry[] => {
    const o = topo.objects[name];
    if (!o) return [];
    return o.type === "GeometryCollection" ? o.geometries ?? [] : [o];
  };
  const countries = geoms("countries").flatMap(polygons);
  const land = geoms("land").flatMap(polygons);
  return { land: land.length ? land : countries, borders: countries.flatMap((p) => p) };
}
