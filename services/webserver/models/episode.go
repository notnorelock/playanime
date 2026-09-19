package models

// WatchEpisode mirrors what toWatchEpisode() in
// packages/api/src/modules/episodes/watch.mapper.ts returns as the
// `episode` field of GET /api/v1/episodes/:episodeId's response.
type WatchEpisode struct {
	ID              string  `json:"id"`
	EntryID         string  `json:"entryId"`
	Number          int     `json:"number"`
	AbsoluteNumber  *int    `json:"absoluteNumber"`
	Title           *string `json:"title"`
	Synopsis        *string `json:"synopsis"`
	AiredAt         *string `json:"airedAt"`
	DurationSeconds *int    `json:"durationSeconds"`
	IsFiller        bool    `json:"isFiller"`
	IsRecap         bool    `json:"isRecap"`
}

// WatchEntry mirrors toWatchEntry()'s `entry` field on the same response —
// the specific release (season/cour/movie/OVA) the episode belongs to.
// Since the Series/Entry catalogue redesign this replaced the old flat
// `anime` field; a series' own title lives separately on WatchSeries below.
type WatchEntry struct {
	ID           string    `json:"id"`
	Slug         string    `json:"slug"`
	Title        string    `json:"title"`
	EntryType    string    `json:"entryType"`
	SeasonNumber *int      `json:"seasonNumber"`
	CourNumber   *int      `json:"courNumber"`
	Status       string    `json:"status"`
	Poster       *ImageRef `json:"poster"`
}

// WatchSeries mirrors toWatchSeries()'s `series` field — the rateable/
// listable parent of the entry above. This is what OG tags should title
// the page after (e.g. "Attack on Titan"), not the entry's own possibly
// season-specific title (e.g. "Season 2").
type WatchSeries struct {
	ID    string `json:"id"`
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

// WatchBootstrap mirrors the full response of GET /api/v1/episodes/:episodeId
// (packages/api/src/modules/episodes/watch.service.ts's getWatchBootstrap).
// Addressed by episode id alone — there is no separate seriesId route
// parameter; the series is resolved server-side from the episode.
type WatchBootstrap struct {
	Episode           WatchEpisode `json:"episode"`
	Entry             WatchEntry   `json:"entry"`
	Series            WatchSeries  `json:"series"`
	PreviousEpisodeID *string      `json:"previousEpisodeId"`
	NextEpisodeID     *string      `json:"nextEpisodeId"`
}
