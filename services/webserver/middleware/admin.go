package middleware

import (
	"net/http"
	"playanime/server/config"
	"playanime/server/services"
	"strings"

	"github.com/gin-gonic/gin"
)

// AdminOnly gates source map access to moderators and admins. It never
// verifies a token itself — PlayAnime's session token is an opaque, random
// value with only its SHA-256 hash stored server-side, meaningless to
// inspect locally — it forwards whatever session cookie the browser sent
// to GET /api/v1/auth/me and trusts the backend's answer.
func AdminOnly(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only check for source map files.
		if !strings.HasSuffix(c.Request.URL.Path, ".map") {
			c.Next()
			return
		}

		sessionToken, err := c.Cookie(cfg.SessionCookieName)
		if err != nil || sessionToken == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Unauthorized - Source maps are only accessible by administrators",
			})
			c.Abort()
			return
		}

		authService := services.NewAuthService(cfg)
		user, err := authService.VerifySession(cfg.SessionCookieName, sessionToken)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid or expired session",
			})
			c.Abort()
			return
		}

		// Moderator or admin, mirroring hasAtLeastRole(role, UserRole.MODERATOR)
		// on the backend — source maps are a debugging aid for staff, not
		// admin-exclusive.
		if !user.IsAtLeast("moderator") {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "Forbidden - Source maps require staff access",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
