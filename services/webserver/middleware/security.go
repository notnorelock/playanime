package middleware

import (
	"strings"
	
	"github.com/gin-gonic/gin"
	"playanime/server/config"
)

func Security(cfg ...*config.Config) gin.HandlerFunc {
	// Job recruitment messages (ASCII-safe)
	jobMessages := []string{
		"Szukamy programistow! Dolacz do naszego zespolu: kontakt@playani.me",
		"Masz doswiadczenie z Go/Vue.js? Napisz do nas: kontakt@playani.me",
		"Chcesz pracowac z nami? Sprawdz: https://playani.me/careers",
		"Programista Backend/Frontend? Czekamy na Ciebie! kontakt@playani.me",
		"Dolacz do zespolu PlayAnime! Szukamy developerow: kontakt@playani.me",
		"Pasjonujesz sie anime i programowaniem? kontakt@playani.me",
	}
	
	return func(c *gin.Context) {
		// Server identification
		c.Writer.Header().Set("Server", "glassnime-engine")
		c.Writer.Header().Set("X-Server", "glassnime-engine")
		
		// Random job recruitment message
		randomJob := jobMessages[len(c.Request.URL.Path)%len(jobMessages)]
		c.Writer.Header().Set("X-Jobs", randomJob)
		
		// Security headers
		c.Writer.Header().Set("X-Content-Type-Options", "nosniff")
		c.Writer.Header().Set("X-Frame-Options", "DENY")
		c.Writer.Header().Set("X-XSS-Protection", "1; mode=block")
		c.Writer.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		
		// Build CSP dynamically from config
		var cspConfig *config.Config
		if len(cfg) > 0 {
			cspConfig = cfg[0]
		}
		
		// Base CSP
		scriptHosts := "'self' 'unsafe-inline' 'unsafe-eval' blob: https: http: http://localhost:* http://127.0.0.1:* https://playani.me"
		connectHosts := "'self' https: http: http://localhost:* http://127.0.0.1:* ws://localhost:* wss://*"
		imageHosts := "'self' data: blob: https: http://localhost:* http://127.0.0.1:*"
		
		// Add custom hosts from config
		if cspConfig != nil {
			if len(cspConfig.CSP.AllowedScriptHosts) > 0 {
				scriptHosts += " " + strings.Join(cspConfig.CSP.AllowedScriptHosts, " ")
			}
			if len(cspConfig.CSP.AllowedConnectHosts) > 0 {
				connectHosts += " " + strings.Join(cspConfig.CSP.AllowedConnectHosts, " ")
			}
			if len(cspConfig.CSP.AllowedImageHosts) > 0 {
				imageHosts += " " + strings.Join(cspConfig.CSP.AllowedImageHosts, " ")
			}
		}
		
		csp := "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: http://localhost:* http://127.0.0.1:* https://playani.me https://*.playani.me; " +
			"worker-src 'self' blob:; " +
			"script-src " + scriptHosts + "; " +
			"script-src-elem " + scriptHosts + "; " +
			"img-src " + imageHosts + "; " +
			"font-src 'self' data: https:; " +
			"media-src 'self' blob: data: https: http://localhost:* http://127.0.0.1:* https://playani.me https://*.playani.me; " +
			"connect-src " + connectHosts + ";"
		
		c.Writer.Header().Set("Content-Security-Policy", csp)

		c.Next()
	}
}
