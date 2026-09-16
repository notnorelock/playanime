package router

import (
	"playanime/server/config"
	"playanime/server/handlers"
	"playanime/server/middleware"

	"github.com/gin-gonic/gin"
)

func Setup(cfg *config.Config) *gin.Engine {
	r := gin.Default()

	// Middleware
	r.Use(middleware.CORS())
	r.Use(middleware.Security(cfg))

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "ok",
			"env":    cfg.Env,
		})
	})

	// Initialize handlers
	staticHandler := handlers.NewStaticHandler(cfg)
	seoHandler := handlers.NewSEOHandler(cfg)

	// Static assets (CSS, JS, images) with optional source map protection
	assetsGroup := r.Group("/assets")
	assetsGroup.Use(middleware.StaticHeaders()) // Add custom headers to static files
	if cfg.EnableSourceMaps && cfg.Env == "production" {
		// Apply admin-only middleware for source maps (only in production)
		assetsGroup.Use(middleware.AdminOnly(cfg))
	}
	assetsGroup.Static("", cfg.ClientDistPath+"/assets")

	// JavaScript files (production builds) - serve with correct MIME type
	jsGroup := r.Group("/js")
	jsGroup.Use(middleware.StaticHeaders())
	if cfg.EnableSourceMaps && cfg.Env == "production" {
		// Apply admin-only middleware for source maps (*.js.map files, only in production)
		jsGroup.Use(middleware.AdminOnly(cfg))
	}
	jsGroup.Static("", cfg.ClientDistPath+"/js")

	// Static files
	r.GET("/favicon.ico", middleware.StaticHeaders(), staticHandler.ServeFavicon)
	r.GET("/version.json", middleware.StaticHeaders(), staticHandler.ServeVersion)

	// API proxy to backend (optional, for unified domain)
	api := r.Group("/api")
	api.Use(middleware.ProxyToBackend(cfg))
	{
		api.Any("/*path", func(c *gin.Context) {
			// This will be handled by the proxy middleware
		})
	}

	// Dynamic SEO routes - handle specific routes with custom OG tags.
	// These fetch data from backend and inject meta tags for crawlers.
	// Route params match the frontend's actual route params exactly
	// (packages/web/src/views/**/[param].vue) — every title/profile in
	// this app is addressed by slug or username, never a numeric id, and
	// the watch route takes only an episode id (the anime is resolved
	// server-side from the episode, see watch.service.ts).
	//
	// "/translator/create" is registered separately, below, as a literal
	// SPA route — Gin's router matches a static segment ahead of a param
	// at the same position, so this does not collide with
	// "/translator/:slug" treating "create" as a slug.
	r.GET("/anime/:slug", seoHandler.AnimeDetail)
	r.GET("/watch/:episodeId", seoHandler.WatchEpisode)
	r.GET("/translator/:slug", seoHandler.TranslatorProfile)
	r.GET("/profile/:username", seoHandler.UserProfile)

	// SPA routes - these just serve index.html and let Vue Router handle the
	// rest. These routes don't need SEO because they're not detail pages —
	// either no meaningful per-page OG data (settings, search), or gated
	// behind auth so a crawler could never render them meaningfully anyway
	// (admin dashboard, catalogue authoring, group dashboards).
	//
	// Kept in sync with every static (non-`[param]`) route under
	// packages/web/src/views/ — a route missing here still works, since
	// NoRoute below serves the same SPA shell for anything unmatched, but
	// listing it explicitly documents that it's a real, known route rather
	// than an accident of the catch-all.
	spaRoutes := []string{
		"/",
		"/browse",
		"/trending",
		"/translators",
		"/translator/create",
		"/search",
		"/login",
		"/register",
		"/register/discord",
		"/profile/me",
		"/settings",
		"/admin/dashboard",
		"/catalogue/create",
		"/watchtogether/sessions",
	}

	for _, route := range spaRoutes {
		r.GET(route, staticHandler.ServeSPA)
	}

	// Parameterized SPA routes that intentionally have no custom OG
	// handler. catalogue/manage and translator/dashboard are staff/owner-
	// only editing surfaces with nothing a crawler should index.
	r.GET("/catalogue/manage/:slug", staticHandler.ServeSPA)
	r.GET("/translator/dashboard/:slug", staticHandler.ServeSPA)

	// Legal: both the SPA page (/legal/tos) and the raw markdown asset it
	// fetches client-side (/legal/tos_en.md, from packages/web/public/legal)
	// live under the same "/legal/:file" prefix. One handler serves whichever
	// this actually is, by filename shape — see ServeLegalDocument's doc
	// comment for why this can't be two separate routes.
	r.GET("/legal/:file", staticHandler.ServeLegalDocument)

	// Catch-all route - serve SPA for any unmatched routes (Vue Router's own
	// [...all].vue decides whether that's a real 404).
	r.NoRoute(staticHandler.ServeSPA)

	return r
}
