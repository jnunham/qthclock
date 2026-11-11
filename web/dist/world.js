// Loads the map outlines the server builds from Natural Earth 1:50m
// (public domain): land, lakes, country borders and state/province lines.
// Coordinates arrive as integer hundredths of a degree in flat lists.
/** Fetch the outlines; undefined if the server hasn't finished building them yet. */
export function loadWorld() {
    return fetch("api/world", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : undefined))
        .then((p) => (p && p.v ? unpack(p) : undefined))
        .catch(() => undefined);
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