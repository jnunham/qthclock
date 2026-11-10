const pad = (n) => String(n).padStart(2, "0");
/** Clock, station identity, solar numbers and feed status in one slim bar. */
export class TopBar {
    settings;
    el;
    utc;
    local;
    solar;
    status;
    constructor(el, cfg, settings) {
        this.settings = settings;
        this.el = el;
        el.innerHTML = `
      <div class="ident">
        <div class="call">${cfg.callsign || "NOCALL"}</div>
        <div class="grid muted">${cfg.grid || "set grid in config.json"}${cfg.demo ? ' · <span class="demo">DEMO</span>' : ""}</div>
      </div>
      <div class="clock">
        <div class="utc"></div>
        <div class="local muted"></div>
      </div>
      <div class="solar"></div>
      <div class="status"></div>`;
        this.utc = el.querySelector(".utc");
        this.local = el.querySelector(".local");
        this.solar = el.querySelector(".solar");
        this.status = el.querySelector(".status");
    }
    update(ctx) {
        const s = this.settings();
        const d = new Date(ctx.now);
        const clockEl = this.el.querySelector(".clock");
        clockEl.hidden = !s.show.clock;
        this.utc.innerHTML = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}<span class="sec">:${pad(d.getUTCSeconds())}</span> <span class="z">UTC</span>`;
        this.local.textContent =
            d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) +
                " · local " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        this.solar.hidden = !s.show.solar;
        this.solar.innerHTML = renderSolar(ctx.solar);
        this.status.innerHTML = `
      <span class="dot ${ctx.connected ? "ok" : "bad"}"></span>
      <span>${ctx.connected ? "Live" : "Reconnecting…"}</span>
      <span class="muted">${count(ctx, "me")} hear you · ${count(ctx, "here")} heard</span>`;
    }
}
function renderSolar(s) {
    if (!s)
        return `<span class="muted">Solar data loading…</span>`;
    const item = (label, value, level, title) => `<div class="stat ${level}" title="${title}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
    const sfi = s.sfi ?? NaN;
    const kp = s.kp ?? NaN;
    const sfiLevel = isNaN(sfi) ? "" : sfi >= 150 ? "good" : sfi >= 90 ? "fair" : "poor";
    const kpLevel = isNaN(kp) ? "" : kp < 3 ? "good" : kp < 5 ? "fair" : "poor";
    const xLevel = !s.xray ? "" : /^[XM]/.test(s.xray) ? "poor" : /^C/.test(s.xray) ? "fair" : "good";
    return (item("SFI", isNaN(sfi) ? "—" : sfi.toFixed(0), sfiLevel, "10.7 cm solar flux: higher means better HF above 20 m") +
        item("Kp", isNaN(kp) ? "—" : kp.toFixed(1), kpLevel, "Planetary K index: 5+ is a geomagnetic storm") +
        item("X-ray", s.xray ?? "—", xLevel, "GOES X-ray class: M/X flares can black out sunlit HF paths"));
}
function count(ctx, rel) {
    const calls = new Set();
    for (const s of ctx.spots)
        if (s.rel === rel)
            calls.add(rel === "me" ? s.de : s.dx);
    return calls.size;
}
//# sourceMappingURL=topbar.js.map