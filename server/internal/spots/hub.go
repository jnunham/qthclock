package spots

import (
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Hub keeps a short history of spots, removes duplicates, and pushes batches
// to subscribers a few times per second. Batching keeps the browser smooth
// even when PSK Reporter is delivering hundreds of spots per second.
type Hub struct {
	mu        sync.Mutex
	history   []Spot // ring, oldest first
	maxKeep   int
	maxAge    time.Duration
	pending   []Spot
	maxBatch  int
	seen      map[string]int64 // dedup key -> unix ms
	dedupWin  time.Duration
	subs      map[chan Event]struct{}
	nextID    atomic.Uint64
	lastState map[string]json.RawMessage // latest value of each "state" event (solar, status)

	// Counters for /api/health.
	Received atomic.Uint64
	Dropped  atomic.Uint64
}

// Event is one server-sent event.
type Event struct {
	Name string
	Data []byte
}

func NewHub(maxKeep int, maxAge time.Duration) *Hub {
	h := &Hub{
		maxKeep:   maxKeep,
		maxAge:    maxAge,
		maxBatch:  400,
		seen:      map[string]int64{},
		dedupWin:  90 * time.Second,
		subs:      map[chan Event]struct{}{},
		lastState: map[string]json.RawMessage{},
	}
	go h.loop()
	return h
}

// Publish accepts a spot from any source. Safe for concurrent use.
func (h *Hub) Publish(s Spot) {
	h.Received.Add(1)
	if s.Time == 0 {
		s.Time = time.Now().UnixMilli()
	}
	if s.Band == "" {
		s.Band = BandForKHz(s.FreqKHz)
	}
	key := s.Source + "|" + strings.ToUpper(s.DX) + "|" + strings.ToUpper(s.DE) + "|" + s.Band + "|" + s.Mode

	h.mu.Lock()
	defer h.mu.Unlock()
	if last, ok := h.seen[key]; ok && s.Source != "demo" && s.Time-last < h.dedupWin.Milliseconds() {
		h.Dropped.Add(1)
		return
	}
	h.seen[key] = s.Time
	s.ID = h.nextID.Add(1)
	h.history = append(h.history, s)
	if len(h.history) > h.maxKeep {
		h.history = h.history[len(h.history)-h.maxKeep:]
	}
	h.pending = append(h.pending, s)
}

// SetState stores and broadcasts a named state blob (e.g. "solar"). New
// subscribers receive the latest of each state immediately on connect.
func (h *Hub) SetState(name string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.Lock()
	h.lastState[name] = b
	h.mu.Unlock()
	h.broadcast(Event{Name: name, Data: b})
}

// Subscribe returns a channel of events plus an unsubscribe func. The first
// events are a snapshot of recent spots and the current state blobs.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 64)
	h.mu.Lock()
	snap := make([]Spot, len(h.history))
	copy(snap, h.history)
	states := make([]Event, 0, len(h.lastState))
	for k, v := range h.lastState {
		states = append(states, Event{Name: k, Data: v})
	}
	h.subs[ch] = struct{}{}
	h.mu.Unlock()

	b, _ := json.Marshal(snap)
	ch <- Event{Name: "snapshot", Data: b}
	for _, e := range states {
		ch <- e
	}
	return ch, func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
}

func (h *Hub) broadcast(e Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default: // slow client: skip this batch rather than stall everyone
		}
	}
}

func (h *Hub) loop() {
	flush := time.NewTicker(250 * time.Millisecond)
	prune := time.NewTicker(30 * time.Second)
	for {
		select {
		case <-flush.C:
			h.mu.Lock()
			batch := h.pending
			h.pending = nil
			h.mu.Unlock()
			if len(batch) == 0 {
				continue
			}
			if len(batch) > h.maxBatch { // firehose guard: keep the newest
				h.Dropped.Add(uint64(len(batch) - h.maxBatch))
				batch = batch[len(batch)-h.maxBatch:]
			}
			b, _ := json.Marshal(batch)
			h.broadcast(Event{Name: "spots", Data: b})
		case <-prune.C:
			cut := time.Now().Add(-h.maxAge).UnixMilli()
			dcut := time.Now().Add(-h.dedupWin).UnixMilli()
			h.mu.Lock()
			i := 0
			for i < len(h.history) && h.history[i].Time < cut {
				i++
			}
			h.history = h.history[i:]
			for k, t := range h.seen {
				if t < dcut {
					delete(h.seen, k)
				}
			}
			h.mu.Unlock()
		}
	}
}

// Stats for the health endpoint.
func (h *Hub) Stats() map[string]any {
	h.mu.Lock()
	defer h.mu.Unlock()
	return map[string]any{
		"history":  len(h.history),
		"clients":  len(h.subs),
		"received": h.Received.Load(),
		"dropped":  h.Dropped.Load(),
	}
}
