package models

// ImageRef mirrors ImageRef in packages/contracts/src/common/index.ts.
type ImageRef struct {
	URL      string  `json:"url"`
	Blurhash *string `json:"blurhash"`
	Width    *int    `json:"width"`
	Height   *int    `json:"height"`
}

// Genre mirrors AnimeGenre.
type Genre struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// AnimeSummary mirrors SeriesSummaryDto (packages/contracts/src/anime/index.ts)
// — the shape GET /api/v1/anime/:slug actually returns since the Series/Entry
// catalogue redesign. `Title` is a plain string directly on the series (not a
// nested romaji/english/native object — that shape now belongs to an
// individual Entry, EntrySummaryDto/EntryDetailDto, which this handler never
// reads). AnimeDetail extends this with a few more fields; this handler only
// needs what's here for meta tags, so the extra detail fields are not
// modeled.
type AnimeSummary struct {
	ID            string    `json:"id"`
	Slug          string    `json:"slug"`
	Title         string    `json:"title"`
	Format        *string   `json:"format"`
	Status        *string   `json:"status"`
	SeasonYear    *int      `json:"seasonYear"`
	Season        *string   `json:"season"`
	EpisodeCount  *int      `json:"episodeCount"`
	AverageRating *float64  `json:"averageRating"`
	Poster        *ImageRef `json:"poster"`
	Genres        []Genre   `json:"genres"`
}

// AnimeDetail mirrors SeriesDetailDto — adds the synopsis/banner fields the
// anime detail page (and this server's OG tags) actually need.
type AnimeDetail struct {
	AnimeSummary
	Synopsis *string   `json:"synopsis"`
	Banner   *ImageRef `json:"banner"`
}
