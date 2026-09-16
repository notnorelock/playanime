package models

// ImageRef mirrors ImageRef in packages/contracts/src/common/index.ts.
type ImageRef struct {
	URL      string  `json:"url"`
	Blurhash *string `json:"blurhash"`
	Width    *int    `json:"width"`
	Height   *int    `json:"height"`
}

// AnimeTitles mirrors AnimeTitles. There is no Polish/localized title —
// removed platform-wide; a title is never translated, only the content
// around it (see AGENTS.md).
type AnimeTitles struct {
	Romaji  string  `json:"romaji"`
	English *string `json:"english"`
	Native  *string `json:"native"`
}

// Genre mirrors AnimeGenre.
type Genre struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// AnimeSummary mirrors AnimeSummary — the shape GET /api/v1/anime/:slug
// returns (AnimeDetail extends this with a few more fields; this handler
// only needs what's here for meta tags, so the extra detail fields are not
// modeled).
type AnimeSummary struct {
	ID            string      `json:"id"`
	Slug          string      `json:"slug"`
	Titles        AnimeTitles `json:"titles"`
	Format        string      `json:"format"`
	Status        string      `json:"status"`
	SeasonYear    *int        `json:"seasonYear"`
	Season        *string     `json:"season"`
	EpisodeCount  *int        `json:"episodeCount"`
	AverageRating *float64    `json:"averageRating"`
	Poster        *ImageRef   `json:"poster"`
	Genres        []Genre     `json:"genres"`
}

// AnimeDetail mirrors AnimeDetail — adds the synopsis/banner fields the
// anime detail page (and this server's OG tags) actually need.
type AnimeDetail struct {
	AnimeSummary
	Synopsis *string   `json:"synopsis"`
	Banner   *ImageRef `json:"banner"`
}

// DisplayTitle picks the title to show, the same rule as
// packages/web/src/models/anime.ts's pickTitle(): English if requested,
// romaji otherwise. This server has no per-request locale (crawlers don't
// send one meaningfully), so it always uses romaji — matching this app's
// non-English default.
func (a *AnimeTitles) DisplayTitle() string {
	return a.Romaji
}
