package middleware

import (
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// StaticHeaders adds custom headers to static file responses
func StaticHeaders() gin.HandlerFunc {
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

		// Set appropriate Content-Type based on file extension
		path := c.Request.URL.Path
		ext := strings.ToLower(filepath.Ext(path))

		switch ext {
		case ".js":
			c.Writer.Header().Set("Content-Type", "application/javascript; charset=utf-8")
			// Immutable cache for hashed JS files (production builds)
			if strings.Contains(path, "/js/") {
				c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
		case ".css":
			c.Writer.Header().Set("Content-Type", "text/css; charset=utf-8")
			c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case ".json":
			c.Writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		case ".woff", ".woff2":
			c.Writer.Header().Set("Content-Type", "font/woff2")
			c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case ".svg":
			c.Writer.Header().Set("Content-Type", "image/svg+xml")
			c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case ".png":
			c.Writer.Header().Set("Content-Type", "image/png")
			c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case ".jpg", ".jpeg":
			c.Writer.Header().Set("Content-Type", "image/jpeg")
			c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case ".webp":
			c.Writer.Header().Set("Content-Type", "image/webp")
			c.Writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case ".md":
			c.Writer.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			c.Writer.Header().Set("Cache-Control", "public, max-age=3600") // 1 hour cache for markdown
		}

		c.Next()
	}
}
