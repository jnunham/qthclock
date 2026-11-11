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
  kp?: number;       // latest estimated Kp
  kpMax24?: number;  // highest 3-hour Kp in the last 24 h
  a?: number;        // estimated planetary A, today
  hpiN?: number;     // hemispheric power, GW
  hpiS?: number;
  xray?: string;
  xrayRaw?: number;
  kp24?: { t: number; kp: number }[];
  aurora?: number;   // aurora image version
  updated: number;
}

export interface ServerConfig {
  callsign: string;
  grid: string;
  lat?: number;
  lon?: number;
  demo: boolean;
  nearKm: number;
  configured: boolean;
  country?: string; // my DXCC entity
  cont?: string;    // my continent
  wavelog: boolean;
  boot: number;
  ips?: string[];
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
  src: string;
  lat?: number;
  lon?: number;
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
  qsos: QSO[];
  wavelog?: { ok: boolean; error: string; at: number };
  /** Where you're being spotted right now (from PSK Reporter / RBN). */
  onAir?: OnAir;
  /** The band/mode the display is following (onAir, when "follow" is on). */
  active?: { band: string; mode: string };
}

/** The band and mode you're being spotted on, worked out from your spots. */
export interface OnAir {
  band: string;
  mode: string;
  last: number;    // time of the newest spot on that band/mode
  count: number;   // spots in the last 10 minutes
}
