package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"playanime/server/config"
	"strings"

	"github.com/gin-gonic/gin"
)

type StaticHandler struct {
	cfg *config.Config
}

func NewStaticHandler(cfg *config.Config) *StaticHandler {
	return &StaticHandler{cfg: cfg}
}

func (h *StaticHandler) ServeSPA(c *gin.Context) {
	indexPath := h.cfg.ClientDistPath + "/index.html"

	// Always read fresh index.html (no caching)
	content, err := os.ReadFile(indexPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to load application",
		})
		return
	}

	html := string(content)

	// Replace placeholders with default values for SPA routes
	html = strings.ReplaceAll(html, "{{PAGE_TITLE}}", defaultTitle)
	html = strings.ReplaceAll(html, "{{PAGE_DESCRIPTION}}", defaultDescription)
	html = strings.ReplaceAll(html, "{{OG_TYPE}}", defaultOGType)
	html = strings.ReplaceAll(html, "{{OG_URL}}", defaultOGURL)
	html = strings.ReplaceAll(html, "{{OG_TITLE}}", defaultTitle)
	html = strings.ReplaceAll(html, "{{OG_DESCRIPTION}}", defaultDescription)
	html = strings.ReplaceAll(html, "{{OG_IMAGE}}", defaultOGImage)

	// Remove HTML comments from head section
	html = removeHeadComments(html)

	// Inject empty SSR data for SPA routes
	html = h.injectSSRData(html, map[string]interface{}{
		"route": c.Request.URL.Path,
		"type":  "spa",
	})

	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// injectSSRData injects initial data into HTML for client-side hydration
func (h *StaticHandler) injectSSRData(html string, data map[string]interface{}) string {
	// Convert data to JSON
	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("Failed to marshal SSR data: %v", err)
		return html
	}

	// Inject before closing </head> tag
	ssrScript := fmt.Sprintf(`
  <script>window.__PLAYANIME_DATA__=%s;</script>`, string(jsonData))

	html = strings.Replace(html, "</head>", ssrScript+"\n</head>", 1)
	return html
}

func (h *StaticHandler) ServeFavicon(c *gin.Context) {
	faviconPath := h.cfg.ClientDistPath + "/favicon.ico"
	if _, err := os.Stat(faviconPath); err == nil {
		c.File(faviconPath)
	} else {
		c.Status(404)
	}
}

func (h *StaticHandler) ServeVersion(c *gin.Context) {
	versionPath := h.cfg.ClientDistPath + "/version.json"
	if _, err := os.Stat(versionPath); err == nil {
		c.File(versionPath)
	} else {
		c.Status(404)
	}
}

// ServeLegalDocument serves a raw markdown file from packages/web/public/legal
// (Vite copies public/ verbatim into dist/, so it ends up at
// {ClientDistPath}/legal at runtime). The frontend's /legal/[page].vue page
// fetches these itself — GET /legal/privacy_pl.md, not this server rendering
// the markdown — so this only needs to hand back the raw file.
//
// This is a named route ("/legal/:file", not a *filepath Static group)
// specifically so it cannot collide with the SPA page route registered at
// "/legal/:page" for the same prefix: Gin does not allow two different
// wildcard/param route trees under one path segment, which a bare
// r.Static("/legal", ...) alongside r.GET("/legal/:page", ...) would be.
// The two are told apart by filename shape instead — a request that isn't
// for an actual .md file on disk falls through to the SPA shell, so
// /legal/tos (the page) and /legal/tos_en.md (the asset it fetches) both
// resolve correctly through this one handler.
func (h *StaticHandler) ServeLegalDocument(c *gin.Context) {
	file := c.Param("file")

	if !strings.HasSuffix(file, ".md") || strings.Contains(file, "/") || strings.Contains(file, "..") {
		h.ServeSPA(c)
		return
	}

	path := h.cfg.ClientDistPath + "/legal/" + file
	if _, err := os.Stat(path); err != nil {
		h.ServeSPA(c)
		return
	}

	c.Header("Content-Type", "text/markdown; charset=utf-8")
	c.File(path)
}
