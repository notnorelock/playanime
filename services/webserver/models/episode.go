package models

// WatchEpisode mirrors what toWatchEpisode() in
// packages/api/src/modules/episodes/watch.mapper.ts returns as the
// `episode` field of GET /api/v1/episodes/:episodeId's response.
type WatchEpisode struct {
	ID              string  `json:"id"`
	AnimeID         string  `json:"animeId"`
	Number          int     `json:"number"`
	AbsoluteNumber  *int    `json:"absoluteNumber"`
	Title           *string `json:"title"`
	Synopsis        *string `json:"synopsis"`
	AiredAt         *string `json:"airedAt"`
	DurationSeconds *int    `json:"durationSeconds"`
	IsFiller        bool    `json:"isFiller"`
	IsRecap         bool    `json:"isRecap"`
}

// WatchAnime mirrors toWatchAnime()'s `anime` field on the same response —
// a smaller shape than the full AnimeSummary, just what the watch page
// needs.
type WatchAnime struct {
	ID     string    `json:"id"`
	Slug   string    `json:"slug"`
	Title  string    `json:"title"`
	Format string    `json:"format"`
	Status string    `json:"status"`
	Poster *ImageRef `json:"poster"`
}

// WatchBootstrap mirrors the full response of GET /api/v1/episodes/:episodeId
// (packages/api/src/modules/episodes/watch.service.ts's getWatchBootstrap).
// Addressed by episode id alone — there is no separate animeId route
// parameter; the anime is resolved server-side from the episode.
type WatchBootstrap struct {
	Episode           WatchEpisode `json:"episode"`
	Anime             WatchAnime   `json:"anime"`
	PreviousEpisodeID *string      `json:"previousEpisodeId"`
	NextEpisodeID     *string      `json:"nextEpisodeId"`
}
