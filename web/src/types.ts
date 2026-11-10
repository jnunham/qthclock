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
}

/** The station the operator is looking at (clicked on the map or a list). */
export interface DXSelection {
  call: string;
  lat: number;
  lon: number;
  grid?: string;
  spot?: Spot;
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
}
