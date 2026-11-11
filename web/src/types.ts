/** One spot, as sent by the server (short keys keep the stream small). */
export interface Spot {
  id: number;
  src: "pskr" | "rbn" | "cluster" | "demo" | string;
  t: number;   // unix ms
  f: number;   // kHz
  b: string;   // band, e.g. "20m"
  m: string;   // mode
  dx: string;  // station heard
  dxg?: string;
  dxla?: number;
  dxlo?: number;
  dxc?: string; // DX country (DXCC entity)
  dxk?: string; // DX continent
  de: string;  // spotter
  deg?: string;
  dela?: number;
  delo?: number;
  snr?: number;
  wpm?: number;
  c?: string;
  /** "me": someone heard me · "here": I heard them · "near": spotted near my QTH */
  rel: "me" | "here" | "near";
  km?: number;
}

export interface Solar {
  sfi?: number;
  kp?: number;
  xray?: string;
  xrayRaw?: number;
  updated: number;
}

export interface ServerConfig {
  callsign: string;
  grid: string;
  lat?: number;
  lon?: number;
  mapStyle: string;
  demo: boolean;
  nearKm: number;
  configured: boolean;
  country?: string; // my DXCC entity
  cont?: string;    // my continent
  wavelog: boolean;
  boot: number;
  ips?: string[];
}

/** The station WSJT-X says you're working right now (call is "" between QSOs). */
export interface Working {
  call: string;
  grid?: string;
  lat?: number;
  lon?: number;
  f: number;
  b: string;
  m: string;
  report?: string;
  txEnabled: boolean;
  tx: boolean;
  updated: number;
}

export interface QSO {
  call: string;
  t: number;
  b?: string;
  m?: string;
  sent?: string;
  rcvd?: string;
  grid?: string;
  name?: string;
  country?: string;
  src: "wavelog" | "wsjtx";
}

/** The station the operator is looking at (clicked on the map or a list). */
export interface DXSelection {
  call: string;
  lat: number;
  lon: number;
  grid?: string;
  spot?: Spot;
  /** Why this station is the DX: you're working it, you clicked it, or it was picked automatically. */
  reason?: "working" | "manual" | "last";
}

/** Every panel implements this; main.ts calls update() about once a second. */
export interface Panel {
  el: HTMLElement;
  update(ctx: UpdateContext): void;
}

export interface UpdateContext {
  now: number;
  spots: Spot[];         // filtered, newest first
  allCount: number;      // before filtering
  ratePerMin: number;
  solar?: Solar;
  connected: boolean;
  dx?: DXSelection;
  select(sel: DXSelection | undefined): void;
  working?: Working; // only while WSJT-X is running
  qsos: QSO[];
  wavelog?: { ok: boolean; error: string; at: number };
  wsjtx?: WSJTXInfo;
  /** The band/mode the radio is on, when following the radio. */
  active?: { band: string; mode: string };
}

/** Listener diagnostics, shown when the radio looks idle. */
export interface WSJTXInfo {
  listen: string;
  error?: string;
  lastFrom?: string;
  lastAt?: number;
  packets: number;
}
