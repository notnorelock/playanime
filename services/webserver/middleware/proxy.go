package middleware

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"playanime/server/config"

	"github.com/gin-gonic/gin"
)

// ProxyToBackend forwards every /api/* request to the api container.
//
// Built on net/http/httputil.ReverseProxy rather than a hand-rolled
// http.Client-based proxy (the previous implementation) for two reasons,
// both real bugs the old version had in production:
//
//  1. WebSocket upgrades. A WS handshake (GET with Connection: Upgrade,
//     Upgrade: websocket) needs the underlying TCP connection hijacked and
//     piped bidirectionally once the api container returns
//     101 Switching Protocols — an http.Client reads a response with a
//     body and returns, which cannot represent that at all. The old proxy
//     tried anyway (http.Client.Do + io.Copy), producing "Invalid frame
//     header" in the browser: the bytes reaching it were a mangled
//     request/response cycle, never a real duplex socket. ReverseProxy
//     detects a 101 response and switches to raw bidirectional copying
//     automatically (net/http/httputil since Go 1.12) — see
//     packages/api/src/modules/realtime/realtime.controller.ts and
//     packages/realtime for what's on the other end of this connection.
//  2. Redirects. A RoundTripper (what ReverseProxy's Transport is) never
//     follows a 3xx itself — only http.Client.Do does that, which is what
//     the old proxy used and which silently absorbed Discord's OAuth
//     redirect server-side until an explicit CheckRedirect override fixed
//     it (see git history). ReverseProxy needs no equivalent override:
//     RoundTripper.RoundTrip always returns the first response, 3xx
//     included, exactly as this proxy needs.
func ProxyToBackend(cfg *config.Config) gin.HandlerFunc {
	backend, err := url.Parse(cfg.BackendURL)
	if err != nil {
		// BackendURL is operator-supplied config (BACKEND_URL env var), not
		// request input — a malformed value is a deploy-time misconfiguration
		// that should fail loudly at startup, not per-request.
		panic("middleware.ProxyToBackend: invalid BACKEND_URL: " + err.Error())
	}

	proxy := httputil.NewSingleHostReverseProxy(backend)

	// NewSingleHostReverseProxy's default Director only rewrites scheme/host
	// — it does NOT strip a path prefix, which this proxy doesn't need
	// stripped anyway (the api container's own routes already live under
	// /api/v1/..., matching what the browser sent), so the default Director
	// needs no override.

	// ErrorHandler operates on the raw http.ResponseWriter, not *gin.Context,
	// so it writes JSON directly rather than through gin's helpers — same
	// 502 status the old proxy used. The body isn't the API's own
	// {error:{code,message}} envelope (packages/web/src/api/errors.ts
	// parses that shape specifically) since this is webserver, not api,
	// reporting that it couldn't reach api at all — client.ts's own
	// parseErrorEnvelope already falls back to a generic message for a
	// body it doesn't recognize, so this degrades correctly either way.
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"Backend request failed"}`))
	}

	return func(c *gin.Context) {
		proxy.ServeHTTP(c.Writer, c.Request)
		c.Abort()
	}
}
