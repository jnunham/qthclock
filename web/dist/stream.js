/**
 * Server-Sent Events: one long HTTP response the server writes batches into.
 * The browser reconnects by itself, and on reconnect the server sends a fresh
 * snapshot, so a dropped Wi-Fi link heals without a page reload.
 */
export function connectStream(h) {
    const es = new EventSource("api/stream");
    const parse = (fn) => (e) => {
        try {
            fn(JSON.parse(e.data));
        }
        catch (err) {
            console.warn("bad event", err);
        }
    };
    es.addEventListener("snapshot", parse(h.snapshot));
    es.addEventListener("spots", parse(h.spots));
    es.addEventListener("solar", parse(h.solar));
    es.addEventListener("qsos", parse(h.qsos));
    es.addEventListener("settings", parse(h.settings));
    es.addEventListener("wavelog", parse(h.wavelog));
    es.onopen = () => h.status(true);
    es.onerror = () => h.status(false);
    return es;
}
//# sourceMappingURL=stream.js.map