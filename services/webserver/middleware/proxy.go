package middleware

import (
	"io"
	"net/http"
	"playanime/server/config"

	"github.com/gin-gonic/gin"
)

func ProxyToBackend(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Build backend URL
		backendURL := cfg.BackendURL + c.Request.URL.Path
		if c.Request.URL.RawQuery != "" {
			backendURL += "?" + c.Request.URL.RawQuery
		}

		// Create request to backend
		req, err := http.NewRequest(c.Request.Method, backendURL, c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to create backend request",
			})
			c.Abort()
			return
		}

		// Copy headers from original request
		for key, values := range c.Request.Header {
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}

		// Execute request. CheckRedirect must refuse to follow: the default
		// http.Client follows a 3xx itself and returns the *final* response,
		// which for something like GET /api/v1/auth/discord (a 302 to
		// Discord's own authorize page) meant this proxy silently fetched
		// Discord's HTML server-side and served it back under playani.me's
		// own origin — the browser never saw the redirect, so it never
		// actually navigated to Discord. Returning ErrUseLastResponse makes
		// Go stop at the first response and hand it back untouched, so the
		// 302 and its Location header reach the browser as they should.
		client := &http.Client{
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"error": "Backend request failed",
			})
			c.Abort()
			return
		}
		defer resp.Body.Close()

		// Copy response headers
		for key, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(key, value)
			}
		}

		// Copy response status and body
		c.Status(resp.StatusCode)
		io.Copy(c.Writer, resp.Body)
		c.Abort()
	}
}
