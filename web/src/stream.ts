import type { QSO, Solar, Spot, Working, WSJTXInfo } from "./types.js";

export interface StreamHandlers {
  snapshot(spots: Spot[]): void;
  spots(batch: Spot[]): void;
  solar(s: Solar): void;
  working(w: Working): void;
  qsos(q: QSO[]): void;
  settings(s: unknown): void;
  wavelog(w: { ok: boolean; error: string; at: number }): void;
  wsjtx(i: WSJTXInfo): void;
  status(connected: boolean): void;
}

/**
 * Server-Sent Events: one long HTTP response the server writes batches into.
 * The browser reconnects by itself, and on reconnect the server sends a fresh
 * snapshot, so a dropped Wi-Fi link heals without a page reload.
 */
export function connectStream(h: StreamHandlers): EventSource {
  const es = new EventSource("api/stream");
  const parse = <T>(fn: (v: T) => void) => (e: MessageEvent) => {
    try {
      fn(JSON.parse(e.data) as T);
    } catch (err) {
      console.warn("bad event", err);
    }
  };
  es.addEventListener("snapshot", parse<Spot[]>(h.snapshot));
  es.addEventListener("spots", parse<Spot[]>(h.spots));
  es.addEventListener("solar", parse<Solar>(h.solar));
  es.addEventListener("working", parse<Working>(h.working));
  es.addEventListener("qsos", parse<QSO[]>(h.qsos));
  es.addEventListener("settings", parse<unknown>(h.settings));
  es.addEventListener("wsjtx", parse<WSJTXInfo>(h.wsjtx));
  es.addEventListener("wavelog", parse<{ ok: boolean; error: string; at: number }>(h.wavelog));
  es.onopen = () => h.status(true);
  es.onerror = () => h.status(false);
  return es;
}
