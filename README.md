# QTHClock

A shack display built around **your station**. It combines HamClock's at-a-glance operating info with DXLook-style live signal reports, but only shows what matters to you:

- **My signal:** who is hearing you right now on each band, the **average signal report** you're getting (each station's latest report, averaged per mode), and the farthest station (PSK Reporter + RBN).
- **Bands open from here:** for each band, which continents RBN skimmers and cluster spotters near your QTH are hearing (last 15 minutes). A calm propagation summary, refreshed once a minute; no scrolling DX list.
- **On air:** the band and mode you're on, worked out from who's hearing you (like HamSpotter / HamAlert). No radio connection needed.
- **QSOs:** your latest QSOs from **Wavelog**. Your last QSO partner is shown as the DX.
- **DE / DX:** your location and your last QSO partner's (or any station you click): local time, sunrise and sunset, short- and long-path bearing and distance.
- **Map** of the whole world (flat, HamClock-style) with the gray line. Lines run from you to each **station hearing you** (the dot is where that station is); a white circle marks the DX / your last QSO. Colour = band. The gray line is a soft gradient through twilight.
- **Space weather:** SFI, Kp, A index, X-ray class and hemispheric power, "currently" and "past 24 hours" geomagnetic status, NOAA's aurora oval forecast for your hemisphere, and a 24-hour Kp chart.

![QTHClock in demo mode](docs/screenshot.png)

Spots from everyone else in the world are filtered out on the server, so the screen stays calm and the feeds stay light.

## Install and run

QTHClock needs **only Go 1.22 or newer** to build and run. The web front end is already compiled (`web/dist`), so you don't need Node or TypeScript unless you change the front-end code.

### Raspberry Pi / Debian / Ubuntu

```sh
git clone https://github.com/jnunham/qthclock.git
cd qthclock
./scripts/install-prereqs.sh   # installs Go from go.dev (Debian's golang package is too old)
source ~/.profile              # once, so this terminal can find Go
make run
```

On first launch QTHClock asks for your **callsign** and **grid square**: in the terminal if you started it there, otherwise on the web page. It saves them to `config.json`. To change them later, use **Settings › Change callsign / grid**, or edit `config.json`.

Then open **http://localhost:8073** on the Pi, or **http://&lt;pi-address&gt;:8073** from any computer on your network. The terminal prints both addresses.

### Other systems

Install Go 1.22+ from https://go.dev/dl/, then run `make run` (or, without make: `cd server && go build -o ../qthclock . && cd .. && ./qthclock`).

### Commands

| Command | What it does |
|---|---|
| `make run` | Build and start with live feeds |
| `make demo` | Fake traffic around your call; works with no internet |
| `make test` | Run the tests |
| `./scripts/install-prereqs.sh --dev` | Also installs Node + TypeScript, for editing `web/src` |
| `make watch` | Recompile the front end on save (needs `--dev` prereqs) |

Press **s**, or click the gear, for layout, text size, theme and filters. Kiosk example: `http://pi:8073/?preset=wall&scale=1.6&theme=night`.

### Hands-off operation (wall monitor)

QTHClock is built to run on a screen nobody touches:

- **It follows you on the air.** The top bar shows the band and mode you're being spotted on (from PSK Reporter / RBN reports of your call over the last 10 minutes). The map fades the other bands, and "My signal" and "Bands open" highlight your band. To turn this off, untick Settings › On air › Follow my spots.
- **The DX box shows your last QSO** from Wavelog (for 2 hours). A station you click on the map or in a list stays selected for 3 minutes. The farthest station hearing you is listed under "My signal".
- **The map always spans the full width of its panel**, showing all longitudes once on any screen shape (including 34" ultrawides). On wide, short panels it shows roughly 70°N to 40°S; taller panels show more, up to pole to pole. Zoom with the **+ / − / ⌂** buttons on the map (they hide when the mouse is idle) or from **Settings › Map zoom** on your phone; zooming centres on your QTH by default. Lines and dots get thicker on bigger screens. The coastlines and borders (Natural Earth, public domain) are downloaded once to `data/world.json` on first start.
- **It's calm.** The clock ticks every second; the map and panels redraw every 5 seconds, and "Bands open" once a minute. Nothing flashes.
- **Themes:** Dark, Ocean, Slate, Amber, Phosphor, Night (red) and Light. Each restyles the map too.
- **Distances** are in miles by default; switch to kilometres in Settings › Distances.
- **The layout fits the screen.** The panels you have switched on are arranged so the map keeps a world-map shape and nothing is squeezed: on a wide wall layout, space weather gets a tall column beside the map; on other screens, "Bands open" and "Space weather" move under the map when that fits better.
- **You control it from any other device.** Open `http://<pi-address>:8073` on your phone or laptop and change settings there; the monitor updates instantly. Settings are stored on the server (`data/display.json`), not in one browser.
- **It updates itself.** After a `git pull` and restart, open screens reload the new version automatically.
- **Per-screen tweaks** go in the URL and only affect that screen, e.g. `http://localhost:8073/?scale=1.3&preset=balanced`.

#### Start everything at boot (Raspberry Pi)

Run QTHClock as a service:

```sh
make build
mkdir -p ~/.config/systemd/user
cp scripts/qthclock.service ~/.config/systemd/user/
systemctl --user enable --now qthclock
sudo loginctl enable-linger $USER
```

Open the display full-screen at login. On Raspberry Pi OS Bookworm (labwc desktop), add this line to `~/.config/labwc/autostart`:

```sh
chromium-browser --kiosk --noerrdialogs --disable-infobars --password-store=basic http://localhost:8073 &
```

On older Pi OS (X11/LXDE), put the same command in `~/.config/lxsession/LXDE-pi/autostart` with an `@` in front of it instead.

### Wavelog

To show your latest QSOs from Wavelog, edit the `wavelog` section of `config.json` and restart:

```json
"wavelog": {
  "enabled": true,
  "url": "https://log.example.com",
  "apiKey": "wl2_...",
  "stationId": "1"
}
```

- **Wavelog 3.1 or newer:** create an API v2 token with `qso:read` scope (it starts with `wl2_`). `stationId` isn't needed.
- **Older Wavelog:** use a read-only API key from the API keys page in Wavelog's menu, plus your station location ID (the small number badge on the Station Locations page).

`url` is your Wavelog address, with or without `/index.php`. QTHClock checks for new QSOs every minute. If Wavelog uses a self-signed HTTPS certificate, add `"skipTLSVerify": true`.

To test the connection, run this on the Pi:

```sh
./qthclock -check-wavelog
```

It prints the newest QSOs, or exactly what went wrong (wrong URL, bad key, missing `stationId`, Wavelog too old for a v2 token, and so on). The same error also shows in the QSO panel on the display.

## Being polite to the data sources

QTHClock is one server shared by every screen you open; browsers never contact outside services. What the server uses:

| Source | How | How often |
|---|---|---|
| PSK Reporter | One MQTT connection, subscribed only to spots of your call (not the global firehose) | Pushed live; reconnects back off up to 2 min |
| Reverse Beacon Network / DX cluster | One telnet connection each | Pushed live; reconnects back off up to 2 min |
| NOAA SWPC | Small JSON/text files with conditional requests (ETag / If-Modified-Since, so unchanged files cost a 304 with no body) and an identifying User-Agent | Solar flux hourly; Kp 3-hour table every 30 min; Kp now, X-ray and hemispheric power every 10 min; aurora image every 15 min. Errors back off up to an hour |
| Wavelog (your server) | v2: newest 10 QSOs; classic key: full export once, then only new QSOs | Every minute; errors back off up to 10 min |
| country-files.com (cty.dat) | One download | Weekly |
| Natural Earth via jsDelivr (map outline) | One download | Once |

## Config highlights

| Key | Meaning |
|---|---|
| `callsign`, `grid` | Your station (asked for on first launch). Needed for "who hears me", distances and "near me". |
| `nearKm` | "Bands open from here" counts RBN/cluster spots whose spotter is within this distance of you (default 1500 km). |
| `pskreporter.topics` | MQTT topics; `{CALL}` becomes your callsign. Default: who hears you. |
| `rbn.addrs` | `telnet.reversebeacon.net:7000` is CW/RTTY skimmers, `:7001` is FT8/FT4. Both are on by default; drop one if you never use those modes. |
| `wavelog` | Your Wavelog logbook (see above). |
| `cluster` | Any DXSpider/AR-Cluster telnet node. |

## How it works

```
 PSK Reporter MQTT ─┐
 RBN telnet ────────┤    Go server                               browser(s)
 DX cluster telnet ─┼─► normalise → locate → RELEVANCE → dedupe ─► SSE /api/stream
 Wavelog (1 min) ───┘                 │ "me"   someone heard me
 NOAA SWPC (10 min) ───────────────►  │
                                      │ "near" spotter within nearKm of my QTH
                                      └ anything else is dropped
```

- Every feed is a push stream, so nothing is polled. Spots reach the screen in batches four times a second.
- Positions come from grid squares when the spot has one, otherwise from `cty.dat` (downloaded to `data/`, refreshed weekly).
- Server-Sent Events carry data to any number of screens; they reconnect by themselves and get a snapshot on connect.

## Code map

| Path | What |
|---|---|
| `server/internal/sources/relevance.go` | The "is this about me?" filter |
| `server/internal/sources/pskr.go`, `mqtt.go` | PSK Reporter feed (tiny built-in MQTT client) |
| `server/internal/sources/telnet.go` | RBN and DX cluster |
| `server/internal/sources/demo.go` | Fake traffic for UI work |
| `server/internal/geo`, `solar`, `spots` | Grids and cty.dat, NOAA, hub |
| `web/src/panels/dedx.ts` | DE / DX box |
| `web/src/panels/bandsummary.ts` | My signal |
| `web/src/panels/openings.ts` | Bands open from here |
| `web/src/panels/space.ts`, `server/internal/solar` | Space weather panel and the NOAA poller |
| `web/src/layout.ts` | Chooses the screen layout |
| `web/src/panels/qsos.ts` | Recent QSOs |
| `server/internal/logbook` | Recent QSOs, Wavelog client, ADIF parser |
| `web/src/panels/map.ts`, `web/src/world.ts` | The world map (canvas, equirectangular) and its outline loader |
| `web/src/astro.ts` | Sun times, bearings, distances |

To add a panel: write a class with `el` and `update(ctx)`, add it to `sideItems` in `main.ts`, and add a `show` flag in `settings.ts` plus a checkbox in `drawer.ts`.

## Roadmap

- Azimuthal (great-circle) map centered on your QTH
- Band predictions (VOACAP) from your QTH to the selected DX and to each continent
- Flag new countries / band-slots using Wavelog's lookup API
- Radio band/mode from flrig / Hamlib (rigctld) as an alternative to "on air" from spots
- Rotator control from the DX bearing
- Satellite passes, NCDXF beacons, contest and DXpedition calendars
