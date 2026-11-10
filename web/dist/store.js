import { modeGroup } from "./bands.js";
const HARD_MAX = 30000;
const HARD_AGE_MS = 60 * 60 * 1000;
/** Holds recent spots in arrival order (oldest first). */
export class SpotStore {
    spots = [];
    arrivals = []; // local receive times, for the rate meter
    replace(list) {
        this.spots = list.slice(-HARD_MAX);
    }
    add(batch) {
        const now = Date.now();
        for (let i = 0; i < batch.length; i++)
            this.arrivals.push(now);
        this.spots.push(...batch);
        if (this.spots.length > HARD_MAX)
            this.spots = this.spots.slice(-HARD_MAX);
    }
    prune(now) {
        const cut = now - HARD_AGE_MS;
        let i = 0;
        while (i < this.spots.length && this.spots[i].t < cut)
            i++;
        if (i)
            this.spots = this.spots.slice(i);
        const rcut = now - 60_000;
        let j = 0;
        while (j < this.arrivals.length && this.arrivals[j] < rcut)
            j++;
        if (j)
            this.arrivals = this.arrivals.slice(j);
    }
    get size() {
        return this.spots.length;
    }
    get ratePerMin() {
        return this.arrivals.length;
    }
    /** Spots passing the user's filters, newest first. */
    filtered(s, now) {
        const cut = now - s.maxAgeMin * 60_000;
        const bands = s.bands.length ? new Set(s.bands) : null;
        const modes = s.modes.length ? new Set(s.modes) : null;
        const out = [];
        for (let i = this.spots.length - 1; i >= 0; i--) {
            const sp = this.spots[i];
            if (sp.t < cut)
                continue;
            if (s.sources[sp.src] === false)
                continue;
            if (bands && !bands.has(sp.b))
                continue;
            if (modes && !modes.has(modeGroup(sp.m)))
                continue;
            out.push(sp);
        }
        return out;
    }
}
//# sourceMappingURL=store.js.map