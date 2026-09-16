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

		// Execute request
		client := &http.Client{}
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
