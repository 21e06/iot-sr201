package main

import (
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	TCP_HOST        = "10.0.12.34"
	TCP_PORT        = "6722"
	LISTEN_ADDR     = ":8080"
	INTERNAL_SECRET = "bridge-secret"
	TIMEOUT         = 3 * time.Second
	WS_WRITE_WAIT   = 5 * time.Second
)

// ── WebSocket hub ─────────────────────────────────────────────────────────────

type hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}
}

func newHub() *hub {
	return &hub{clients: make(map[*websocket.Conn]struct{})}
}

func (h *hub) register(conn *websocket.Conn) {
	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()
}

func (h *hub) unregister(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
	conn.Close()
}

func (h *hub) broadcast(msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients {
		conn.SetWriteDeadline(time.Now().Add(WS_WRITE_WAIT))
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			delete(h.clients, conn)
			conn.Close()
		}
	}
}

// ── Relay state ───────────────────────────────────────────────────────────────

type relayState struct {
	mu       sync.Mutex
	state    string // "on" | "off"
	timer    *time.Timer
	timerEnd time.Time
}

func newRelayState() *relayState { return &relayState{state: "off"} }

func (rs *relayState) turnOn(seconds int, h *hub) {
	rs.mu.Lock()
	if rs.timer != nil {
		rs.timer.Stop()
	}
	rs.state = "on"
	rs.timerEnd = time.Now().Add(time.Duration(seconds) * time.Second)
	rs.timer = time.AfterFunc(time.Duration(seconds)*time.Second, func() {
		var broadcast bool
		rs.mu.Lock()
		if rs.state == "on" {
			rs.state = "off"
			rs.timer = nil
			rs.timerEnd = time.Time{}
			broadcast = true
		}
		rs.mu.Unlock()
		if broadcast {
			h.broadcast(stateMsg("off", 0))
		}
	})
	rs.mu.Unlock()
	h.broadcast(stateMsg("on", seconds))
}

func (rs *relayState) turnOff(h *hub) {
	rs.mu.Lock()
	if rs.timer != nil {
		rs.timer.Stop()
		rs.timer = nil
	}
	rs.state = "off"
	rs.timerEnd = time.Time{}
	rs.mu.Unlock()
	h.broadcast(stateMsg("off", 0))
}

func (rs *relayState) snapshot() (string, int) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if rs.state == "on" {
		rem := int(time.Until(rs.timerEnd).Seconds())
		if rem < 0 {
			rem = 0
		}
		return "on", rem
	}
	return "off", 0
}

func stateMsg(state string, remaining int) []byte {
	b, _ := json.Marshal(map[string]interface{}{"state": state, "remaining": remaining})
	return b
}

// ── Upgrader ──────────────────────────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	// Auth is enforced via x-internal-secret; origin check not needed here.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func bridgeHandler(h *hub, rs *relayState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		if r.Header.Get("x-internal-secret") != INTERNAL_SECRET {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil || len(body) == 0 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		conn, err := net.DialTimeout("tcp", TCP_HOST+":"+TCP_PORT, TIMEOUT)
		if err != nil {
			w.WriteHeader(http.StatusRequestTimeout)
			return
		}
		defer conn.Close()

		conn.SetWriteDeadline(time.Now().Add(TIMEOUT))
		if _, err = conn.Write(body); err != nil {
			w.WriteHeader(http.StatusRequestTimeout)
			return
		}

		// Update state and broadcast to WebSocket clients.
		cmd := strings.TrimSpace(string(body))
		if cmd == "2X" {
			rs.turnOff(h)
		} else if strings.HasPrefix(cmd, "11:") {
			if n, err := strconv.Atoi(strings.TrimPrefix(cmd, "11:")); err == nil && n > 0 {
				rs.turnOn(n, h)
			}
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}
}

func wsHandler(h *hub, rs *relayState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-internal-secret") != INTERNAL_SECRET {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("ws upgrade:", err)
			return
		}

		h.register(conn)

		// Send current state to the newly connected client.
		state, rem := rs.snapshot()
		conn.SetWriteDeadline(time.Now().Add(WS_WRITE_WAIT))
		conn.WriteMessage(websocket.TextMessage, stateMsg(state, rem))
		conn.SetWriteDeadline(time.Time{})

		// Read loop — keeps the connection alive and detects client disconnect.
		go func() {
			defer h.unregister(conn)
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
			}
		}()
	}
}

func main() {
	h := newHub()
	rs := newRelayState()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", wsHandler(h, rs))
	mux.HandleFunc("/", bridgeHandler(h, rs))

	server := &http.Server{
		Addr:        LISTEN_ADDR,
		Handler:     mux,
		ReadTimeout: 5 * time.Second,
		// No global WriteTimeout — gorilla/websocket hijacks the connection,
		// so WS connections manage their own write deadlines per broadcast.
	}

	log.Println("Bridge running on", LISTEN_ADDR)
	log.Fatal(server.ListenAndServe())
}