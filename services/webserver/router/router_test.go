package router

import (
	"playanime/server/config"
	"testing"
)

// Confirms Setup() doesn't panic on a route-registration conflict. Gin
// panics at router-build time, not at request time, for a genuinely
// conflicting route tree (e.g. a param route and a static file group
// registered at the same path prefix — this caught exactly that bug once
// already, when a stale r.Static("/legal", ...) collided with the newer
// r.GET("/legal/:page", ...)).
func TestSetupDoesNotPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("router.Setup() panicked: %v", r)
		}
	}()

	cfg := &config.Config{
		Port:              "3000",
		Env:               "development",
		BackendURL:        "http://localhost:4000",
		ClientDistPath:    "./testdata",
		EnableSourceMaps:  false,
		SessionCookieName: "playanime_session",
	}

	Setup(cfg)
}
