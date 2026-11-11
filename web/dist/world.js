// Loads the world outline (Natural Earth via world-atlas, public domain) that
// the server downloads once and serves at /api/world, and decodes TopoJSON
// into plain [lon, lat] rings. No map library or tile server needed.
let cached;
export function loadWorld() {
    cached ??= fetch("api/world")
        .then((r) => (r.ok ? r.json() : undefined))
        .then((t) => (t ? decode(t) : undefined))
        .catch(() => undefined);
    return cached;
}
/** Decode a TopoJSON topology into polygons. Exported for testing. */
export function decode(topo) {
    // 1. Decode arcs (delta-encoded, quantized when there's a transform).
    const arcs = topo.arcs.map((arc) => {
        let x = 0, y = 0;
        return arc.map(([a, b]) => {
            if (topo.transform) {
                x += a;
                y += b;
                return [x * topo.transform.scale[0] + topo.transform.translate[0], y * topo.transform.scale[1] + topo.transform.translate[1]];
            }
            return [a, b];
        });
    });
    // 2. An arc index ~i means arc i reversed. Consecutive arcs share an end point.
    const ring = (ids) => {
        const out = [];
        ids.forEach((id, k) => {
            const pts = id >= 0 ? arcs[id] : [...arcs[~id]].reverse();
            out.push(...(k === 0 ? pts : pts.slice(1)));
        });
        return out;
    };
    const polygons = (g) => {
        if (g.type === "Polygon")
            return [g.arcs.map(ring)];
        if (g.type === "MultiPolygon")
            return g.arcs.map((p) => p.map(ring));
        return [];
    };
    const geoms = (name) => {
        const o = topo.objects[name];
        if (!o)
            return [];
        return o.type === "GeometryCollection" ? o.geometries ?? [] : [o];
    };
    const countries = geoms("countries").flatMap(polygons);
    const land = geoms("land").flatMap(polygons);
    return { land: land.length ? land : countries, borders: countries.flatMap((p) => p) };
}
//# sourceMappingURL=world.js.map