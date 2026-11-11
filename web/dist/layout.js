// The map looks best between these height/width ratios: 110° to 180° of
// latitude over 360° of longitude. Outside that it shows empty bands.
const MIN_RATIO = 110 / 360, MAX_RATIO = 180 / 360;
/** Roughly how tall each panel needs to be to show its content (rem). */
const NEED = { dedx: 10, log: 11, mySignal: 15, openings: 14, space: 26 };
/**
 * Arrange the map and whichever panels are switched on as a CSS grid, so a
 * hidden panel never leaves a hole, nothing gets squeezed, and the map's
 * area is close to the shape of a world map (no big empty bands):
 *  - wall:     map on top with space weather in a tall column beside it,
 *              the other panels in one row underneath
 *  - balanced: map on the left with panels beside it in one or two columns;
 *              on screens where that makes the map too tall, "Band openings"
 *              and "Space weather" move underneath the map
 *  - spots:    like balanced with wider panel columns
 *  - map:      the map only
 */
export function gridFor(preset, visible, W, H, rem) {
    const has = (id) => visible.includes(id);
    if (preset === "map" || !visible.length)
        return { columns: "1fr", rows: "1fr", areas: [["map"]] };
    if (preset === "wall") {
        const row = visible.filter((id) => id !== "space");
        const side = has("space") ? ["space"] : [];
        if (!row.length)
            return { columns: `1fr 26rem`, rows: "1fr", areas: [["map", "space"]] };
        const n = row.length;
        return {
            columns: `repeat(${n}, 1fr)${side.length ? " 26rem" : ""}`,
            rows: "1fr 32%",
            areas: [[...Array(n).fill("map"), ...side], [...row, ...side]],
        };
    }
    const colRem = preset === "spots" ? 34 : 29;
    const gap = 0.5 * rem;
    const candidates = [];
    // Wasted map area (in px²) when the map cell is w × h.
    const waste = (w, h) => {
        const r = h / w;
        if (r > MAX_RATIO)
            return (h - w * MAX_RATIO) * w; // empty bands top and bottom
        if (r < MIN_RATIO)
            return (w - h / MIN_RATIO) * h; // empty bands left and right
        return 0;
    };
    // Penalty when panels stacked in a column don't get the height they need.
    const crowding = (columns) => Math.max(0, ...columns.map((c) => c.reduce((a, id) => a + NEED[id] * rem, 0) - H)) * colRem * rem;
    const split = (cols, list) => {
        const per = Math.ceil(list.length / cols);
        return Array.from({ length: cols }, (_, c) => list.slice(c * per, (c + 1) * per)).filter((c) => c.length);
    };
    const stacked = (cols, list, extraMapCols = 0) => {
        // list spread across `cols` side columns, top to bottom
        const per = Math.ceil(list.length / cols);
        const columnsList = Array.from({ length: cols }, (_, c) => list.slice(c * per, (c + 1) * per)).filter((c) => c.length);
        const rows = Math.max(...columnsList.map((c) => c.length));
        const areas = [];
        for (let i = 0; i < rows; i++) {
            areas.push([...Array(1 + extraMapCols).fill("map"), ...columnsList.map((c) => c[Math.min(i, c.length - 1)])]);
        }
        return {
            columns: `${Array(1 + extraMapCols).fill("1fr").join(" ")} ${columnsList.map(() => `${colRem}rem`).join(" ")}`,
            rows: Array.from({ length: rows }, (_, i) => (i === rows - 1 ? "minmax(0, 1fr)" : "auto")).join(" "),
            areas,
        };
    };
    // A) one side column; B) two side columns.
    for (const cols of [1, 2]) {
        if (cols === 2 && visible.length < 3)
            continue;
        const mapW = W - cols * (colRem * rem + gap);
        if (mapW < W * 0.45)
            continue;
        candidates.push({ grid: stacked(cols, visible), waste: waste(mapW, H) + crowding(split(cols, visible)) });
    }
    // C) side column for live info, "Band openings" + "Space weather" under the map.
    const under = visible.filter((id) => id === "openings" || id === "space");
    const beside = visible.filter((id) => !under.includes(id));
    if (under.length && beside.length) {
        const mapW = W - (colRem * rem + gap);
        // Give the panels under the map the height they want, as long as the
        // map keeps a world-map shape.
        const want = (under.includes("space") ? 22 : 15) * rem;
        const mapH = Math.min(mapW * MAX_RATIO, Math.max(mapW * MIN_RATIO, H - want - gap));
        const bottom = H - mapH - gap;
        if (bottom >= 13 * rem) {
            const n = under.length;
            const rowsBeside = beside.length;
            const areas = [];
            for (let i = 0; i < rowsBeside; i++)
                areas.push([...Array(n).fill("map"), beside[i]]);
            areas.push([...under, beside[rowsBeside - 1]]);
            candidates.push({
                grid: {
                    columns: `${Array(n).fill("1fr").join(" ")} ${colRem}rem`,
                    rows: [...Array(rowsBeside).fill(0).map((_, i) => (i === rowsBeside - 1 ? "minmax(0, 1fr)" : "auto")), `${Math.round(bottom)}px`].join(" "),
                    areas,
                },
                waste: crowding([beside]) + Math.max(0, under.length * 0 + (under.includes("space") ? 20 : 13) * rem - bottom) * W,
            });
        }
    }
    // Least wasted space wins; on a tie, the earlier (simpler) layout.
    candidates.sort((a, b) => a.waste - b.waste);
    return candidates[0]?.grid ?? stacked(1, visible);
}
//# sourceMappingURL=layout.js.map