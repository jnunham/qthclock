import type { ServerConfig } from "./types.js";
import { toGrid } from "./astro.js";

/**
 * First-run (and "Change station") dialog: callsign and grid square.
 * Saves to the server, which writes config.json and reconnects the feeds.
 */
export function showSetup(cfg: ServerConfig, firstRun: boolean): Promise<void> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.id = "setup";
    const canLocate = window.isSecureContext && "geolocation" in navigator;
    wrap.innerHTML = `
      <form class="setup-card" autocomplete="off">
        <h1>${firstRun ? "Welcome to QTHClock" : "Your station"}</h1>
        <p class="muted">${firstRun
          ? "QTHClock shows who hears you, what you hear and what DX you can work. First, tell it where your station is."
          : "Changing these restarts the live feeds."}</p>
        <label>Callsign
          <input name="call" required maxlength="12" placeholder="K1ABC" value="${cfg.callsign || ""}" autocapitalize="characters" spellcheck="false">
        </label>
        <label>Grid square <span class="muted">4 or 6 characters</span>
          <span class="grid-row">
            <input name="grid" required maxlength="6" placeholder="FN31pr" value="${cfg.grid || ""}" spellcheck="false">
            ${canLocate ? `<button type="button" class="locate">Use my location</button>` : ""}
          </span>
        </label>
        <p class="muted small">Don't know your grid? Look it up by address at qrz.com/gridmapper or any "Maidenhead locator" site.</p>
        <p class="error" hidden></p>
        <div class="actions">
          ${firstRun ? "" : `<button type="button" class="cancel">Cancel</button>`}
          <button type="submit" class="primary">${firstRun ? "Start" : "Save"}</button>
        </div>
      </form>`;
    document.body.append(wrap);

    const form = wrap.querySelector("form")!;
    const err = wrap.querySelector<HTMLElement>(".error")!;
    const call = form.elements.namedItem("call") as HTMLInputElement;
    const grid = form.elements.namedItem("grid") as HTMLInputElement;
    call.focus();

    wrap.querySelector(".cancel")?.addEventListener("click", () => { wrap.remove(); resolve(); });
    wrap.querySelector(".locate")?.addEventListener("click", () => {
      err.hidden = true;
      navigator.geolocation.getCurrentPosition(
        (p) => (grid.value = toGrid(p.coords.latitude, p.coords.longitude)),
        (e) => { err.textContent = `Couldn't get your location: ${e.message}`; err.hidden = false; },
        { timeout: 10000 },
      );
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      const res = await fetch("api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callsign: call.value, grid: grid.value }),
      }).catch(() => undefined);
      if (!res) {
        err.textContent = "Couldn't reach the QTHClock server.";
        err.hidden = false;
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        err.textContent = body.error ?? "Something went wrong.";
        err.hidden = false;
        return;
      }
      location.reload(); // simplest way to rebuild every panel for the new station
    });
  });
}
