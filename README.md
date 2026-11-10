# QTHClock

A shack display built around **your station**. It combines HamClock's at-a-glance operating info with DXLook-style live signal reports, but only shows what matters to you:

- **My signal:** who is hearing you right now, on which bands, how far, and how loud (PSK Reporter + RBN).
- **Heard here:** what your own receiver is decoding, fed live from WSJT-X / JTDX.
- **DX near you:** cluster and RBN spots heard by skimmers close to your QTH, so these are stations you can very likely work.
- **DE / DX:** your location and the selected station's: local time, sunrise and sunset, short- and long-path bearing and distance. Click any station on the map or in a list to make it the DX.
- **Map** centered on you, with gray line and paths: solid lines for stations hearing you, dashed for stations you hear, rings for DX near you. Colour = band.
- **Solar:** SFI, Kp and X-ray class from NOAA.

![QTHClock in demo mode](docs/screenshot.png)

Spots from everyone else in the world are filtered out on the server, so the screen stays calm and the feeds stay light.

## Quick start

You need **Go 1.22+** and **TypeScript** (`npm i -g typescript`). Nothing else gets installed.

```sh
cp config.example.json config.json   # set "callsign" and "grid"
make demo                            # fake traffic around your call; works offline
make run                             # live
```

Open http://localhost:8073. Press **s**, or click the gear, for layout, text size, theme and filters. Kiosk example: `http://pi:8073/?preset=wall&scale=1.6&theme=night`.

### WSJT-X / JTDX

In WSJT-X, open **Settings › Reporting** and set **UDP Server** to `127.0.0.1`, port `2237`, with "Accept UDP requests" ticked. If QTHClock runs on another machine, set the UDP server to that machine's IP, and set `"wsjtx": {"listen": ":2237"}` in `config.json`. Only one program can own the port, so if you already use GridTracker or a logger on 2237, have WSJT-X send to a secondary port or use multicast (planned).

## Config highlights

| Key | Meaning |
|---|---|
| `callsign`, `grid` | Your station. Needed for "who hears me", distances and "near me". |
| `nearKm` | A cluster/RBN spot is "near you" if its spotter is within this distance (default 1500 km). |
| `pskreporter.topics` | MQTT topics; `{CALL}` becomes your callsign. Defaults: who hears you, and who you hear. |
| `rbn.addrs` | `telnet.reversebeacon.net:7000` (CW/RTTY), add `:7001` for FT8/FT4 skimmers. |
| `cluster` | Any DXSpider/AR-Cluster telnet node. |
| `wsjtx.listen` | UDP address for WSJT-X decodes. |

## How it works

```
 PSK Reporter MQTT ─┐
 RBN telnet ────────┤    Go server                               browser(s)
 DX cluster telnet ─┼─► normalise → locate → RELEVANCE → dedupe ─► SSE /api/stream
 WSJT-X UDP ────────┘                 │ "me"   someone heard me
 NOAA SWPC (10 min) ───────────────►  │ "here" I heard them
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
| `server/internal/sources/wsjtx.go` | WSJT-X UDP decodes |
| `server/internal/sources/demo.go` | Fake traffic for UI work |
| `server/internal/geo`, `solar`, `spots` | Grids and cty.dat, NOAA, hub |
| `web/src/panels/dedx.ts` | DE / DX box |
| `web/src/panels/bandsummary.ts` | My signal / Heard here |
| `web/src/panels/dxspots.ts` | DX near you |
| `web/src/panels/map.ts` | MapLibre map with canvas fallback |
| `web/src/astro.ts` | Sun times, bearings, distances |

To add a panel: write a class with `el` and `update(ctx)`, add it to `sideItems` in `main.ts`, and add a `show` flag in `settings.ts` plus a checkbox in `drawer.ts`.

## Roadmap

- Azimuthal (great-circle) map centered on your QTH
- Band predictions (VOACAP) from your QTH to the selected DX and to each continent
- Log integration (ADIF / Club Log) to flag needed countries and bands in "DX near you"
- Rig control (flrig / Hamlib): click a spot to tune
- Rotator control from the DX bearing
- Satellite passes, NCDXF beacons, contest and DXpedition calendars
- WSJT-X multicast, plus "my area" reports from PSK Reporter
