// Loads the map outlines the server builds from Natural Earth 1:50m
// (public domain): land, lakes, country borders and state/province lines.
// Coordinates arrive as integer hundredths of a degree in flat lists.
let cached;
export function loadWorld() {
    cached ??= fetch("api/world")
        .then((r) => (r.ok ? r.json() : undefined))
        .then((p) => (p && p.v ? unpack(p) : undefined))
        .catch(() => undefined);
    return cached;
}
export function unpack(p) {
    const line = (a) => Float32Array.from(a, (v) => v / 100);
    return {
        land: (p.land ?? []).map((poly) => poly.map(line)),
        lakes: (p.lakes ?? []).map((poly) => poly.map(line)),
        borders: (p.borders ?? []).map(line),
        states: (p.states ?? []).map(line),
    };
}
//# sourceMappingURL=world.js.map