package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"playanime/server/config"
	"playanime/server/services"
	"strings"

	"github.com/gin-gonic/gin"
)

type SEOHandler struct {
	cfg            *config.Config
	backendService *services.BackendService
}

func NewSEOHandler(cfg *config.Config) *SEOHandler {
	return &SEOHandler{
		cfg:            cfg,
		backendService: services.NewBackendService(cfg),
	}
}

// getTemplate loads the index.html template (always fresh — this server
// never caches it, so a new frontend build is picked up without a restart).
func (h *SEOHandler) getTemplate() string {
	indexPath := h.cfg.ClientDistPath + "/index.html"
	content, err := os.ReadFile(indexPath)
	if err != nil {
		log.Printf("Failed to load template: %v", err)
		return "<html><body>Error loading template</body></html>"
	}
	return string(content)
}

// AnimeDetail serves /anime/:slug — the frontend's actual route param name
// (packages/web/src/views/anime/[slug].vue), not a numeric id.
func (h *SEOHandler) AnimeDetail(c *gin.Context) {
	slug := c.Param("slug")

	template := h.getTemplate()

	anime, err := h.backendService.GetAnime(slug)
	if err != nil {
		log.Printf("Failed to fetch anime %s: %v", slug, err)
		html := h.replaceMeta(template, map[string]string{})
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
		return
	}

	description := ""
	if anime.Synopsis != nil {
		description = *anime.Synopsis
	}

	poster := ""
	if anime.Poster != nil {
		poster = anime.Poster.URL
	} else if anime.Banner != nil {
		poster = anime.Banner.URL
	}

	title := anime.Title

	html := h.replaceMeta(template, map[string]string{
		"title":          fmt.Sprintf("%s - PlayAnime", title),
		"description":    description,
		"og:title":       title,
		"og:description": description,
		"og:image":       poster,
		"og:url":         fmt.Sprintf("https://playani.me/anime/%s", anime.Slug),
		"og:type":        "video.tv_show",
	})

	html = h.injectSSRData(html, map[string]interface{}{
		"anime": anime,
		"type":  "anime-detail",
	})

	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// WatchEpisode serves /watch/:episodeId — a single parameter, matching
// packages/web/src/views/watch/[episodeId].vue. There is deliberately no
// animeId in this route: the backend resolves the anime from the episode
// (see watch.service.ts), and carrying a second, redundant id in the URL
// only created a way for it to contradict the real data.
func (h *SEOHandler) WatchEpisode(c *gin.Context) {
	episodeID := c.Param("episodeId")

	template := h.getTemplate()

	bootstrap, err := h.backendService.GetWatchBootstrap(episodeID)
	if err != nil {
		log.Printf("Failed to fetch episode %s: %v", episodeID, err)
		html := h.replaceMeta(template, map[string]string{})
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
		return
	}

	// The series' own title (e.g. "Attack on Titan"), not the entry's —
	// an entry's title can be just "Season 2" or similar, which reads badly
	// as a standalone page title.
	seriesTitle := bootstrap.Series.Title
	title := fmt.Sprintf("%s - Odcinek %d - PlayAnime", seriesTitle, bootstrap.Episode.Number)

	description := fmt.Sprintf("Oglądaj %s - Odcinek %d", seriesTitle, bootstrap.Episode.Number)
	if bootstrap.Episode.Title != nil && *bootstrap.Episode.Title != "" {
		description = *bootstrap.Episode.Title
	}

	image := ""
	if bootstrap.Entry.Poster != nil {
		image = bootstrap.Entry.Poster.URL
	}

	html := h.replaceMeta(template, map[string]string{
		"title":          title,
		"description":    description,
		"og:title":       title,
		"og:description": description,
		"og:image":       image,
		"og:url":         fmt.Sprintf("https://playani.me/watch/%s", episodeID),
		"og:type":        "video.episode",
	})

	html = h.injectSSRData(html, map[string]interface{}{
		"episode": bootstrap.Episode,
		"entry":   bootstrap.Entry,
		"series":  bootstrap.Series,
		"type":    "watch-episode",
	})

	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// TranslatorProfile serves /translator/:slug, matching
// packages/web/src/views/translator/[slug].vue.
func (h *SEOHandler) TranslatorProfile(c *gin.Context) {
	slug := c.Param("slug")

	template := h.getTemplate()

	group, err := h.backendService.GetTranslatorGroup(slug)
	if err != nil {
		log.Printf("Failed to fetch translator group %s: %v", slug, err)
		html := h.replaceMeta(template, map[string]string{})
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
		return
	}

	description := ""
	if group.Description != nil {
		description = *group.Description
	}

	avatar := ""
	if group.Avatar != nil {
		avatar = group.Avatar.URL
	}

	html := h.replaceMeta(template, map[string]string{
		"title":          fmt.Sprintf("%s - Tłumacz - PlayAnime", group.Name),
		"description":    description,
		"og:title":       group.Name,
		"og:description": description,
		"og:image":       avatar,
		"og:url":         fmt.Sprintf("https://playani.me/translator/%s", group.Slug),
		"og:type":        "profile",
	})

	html = h.injectSSRData(html, map[string]interface{}{
		"translator": group,
		"type":       "translator-profile",
	})

	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// UserProfile serves /profile/:username, matching
// packages/web/src/views/profile/[username].vue.
func (h *SEOHandler) UserProfile(c *gin.Context) {
	username := c.Param("username")

	template := h.getTemplate()

	profile, err := h.backendService.GetPublicProfile(username)
	if err != nil {
		log.Printf("Failed to fetch user profile %s: %v", username, err)
		html := h.replaceMeta(template, map[string]string{})
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
		return
	}

	description := fmt.Sprintf("%s's profile on PlayAnime", profile.Username)
	if profile.Bio != nil && *profile.Bio != "" {
		description = *profile.Bio
	}

	displayName := profile.Username
	if profile.DisplayName != nil && *profile.DisplayName != "" {
		displayName = *profile.DisplayName
	}

	avatar := ""
	if profile.Avatar != nil {
		avatar = *profile.Avatar
	}

	html := h.replaceMeta(template, map[string]string{
		"title":          fmt.Sprintf("%s - Profil - PlayAnime", displayName),
		"description":    description,
		"og:title":       fmt.Sprintf("Profil %s", displayName),
		"og:description": description,
		"og:image":       avatar,
		"og:url":         fmt.Sprintf("https://playani.me/profile/%s", profile.Username),
		"og:type":        "profile",
	})

	html = h.injectSSRData(html, map[string]interface{}{
		"user": profile,
		"type": "user-profile",
	})

	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

func (h *SEOHandler) replaceMeta(html string, meta map[string]string) string {
	replacements := map[string]string{
		"{{PAGE_TITLE}}":       getOrDefault(meta, "title", defaultTitle),
		"{{PAGE_DESCRIPTION}}": getOrDefault(meta, "description", defaultDescription),
		"{{OG_TYPE}}":          getOrDefault(meta, "og:type", defaultOGType),
		"{{OG_URL}}":           getOrDefault(meta, "og:url", defaultOGURL),
		"{{OG_TITLE}}":         getOrDefault(meta, "og:title", defaultTitle),
		"{{OG_DESCRIPTION}}":   getOrDefault(meta, "og:description", defaultDescription),
		"{{OG_IMAGE}}":         getOrDefault(meta, "og:image", defaultOGImage),
	}

	for placeholder, value := range replacements {
		html = strings.ReplaceAll(html, placeholder, value)
	}

	html = removeHeadComments(html)

	return html
}

func getOrDefault(meta map[string]string, key, defaultValue string) string {
	if value, ok := meta[key]; ok && value != "" {
		return value
	}
	return defaultValue
}

// injectSSRData injects initial data into HTML for client-side hydration.
// This is a hint for the frontend, not a contract it depends on — the SPA
// still fetches its own data normally; this only lets it skip one
// duplicate request on first paint if it chooses to read
// window.__PLAYANIME_DATA__.
func (h *SEOHandler) injectSSRData(html string, data map[string]interface{}) string {
	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("Failed to marshal SSR data: %v", err)
		return html
	}

	ssrScript := fmt.Sprintf(`
  <script>window.__PLAYANIME_DATA__=%s;</script>`, string(jsonData))

	html = strings.Replace(html, "</head>", ssrScript+"\n</head>", 1)
	return html
}
