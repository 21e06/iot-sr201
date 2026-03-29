package main

import (
	"io"
	"log"
	"net"
	"net/http"
	"time"
)

const (
	TCP_HOST        = "10.0.12.34"
	TCP_PORT        = "6722"
	LISTEN_ADDR     = ":8080"
	INTERNAL_SECRET = "bridge-secret"
	TIMEOUT         = 3 * time.Second
)

func handler(w http.ResponseWriter, r *http.Request) {
	// Method check
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	// Internal auth
	if r.Header.Get("x-internal-secret") != INTERNAL_SECRET {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// Read body
	body, err := io.ReadAll(r.Body)
	if err != nil || len(body) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// TCP connect
	conn, err := net.DialTimeout("tcp", TCP_HOST+":"+TCP_PORT, TIMEOUT)
	if err != nil {
		w.WriteHeader(http.StatusRequestTimeout)
		return
	}
	defer conn.Close()

	// Set write timeout
	conn.SetWriteDeadline(time.Now().Add(TIMEOUT))

	_, err = conn.Write(body)
	if err != nil {
		w.WriteHeader(http.StatusRequestTimeout)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func main() {
	http.HandleFunc("/", handler)

	server := &http.Server{
		Addr:         LISTEN_ADDR,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	log.Println("Bridge running on", LISTEN_ADDR)
	log.Fatal(server.ListenAndServe())
}