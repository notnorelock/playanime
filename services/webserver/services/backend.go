package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"playanime/server/config"
	"playanime/server/models"
)

// BackendService calls the real PlayAnime API under /api/v1. Every call
// here mirrors an actual route in packages/api/src/routes/v1.ts and an
// actual response shape from packages/contracts — see the doc comment on
// each model type for exactly which contract it mirrors and why.
type BackendService struct {
	cfg    *config.Config
	client *http.Client
}

func NewBackendService(cfg *config.Config) *BackendService {
	return &BackendService{cfg: cfg, client: &http.Client{}}
}

// get performs a GET against the backend and decodes the JSON body
// directly into out — this API never wraps a response in a
// { success, data } envelope, it returns the DTO as the whole body. Every
// route this hits (anime/translators/profiles by slug, episodes by id) is
// public with no auth requirement, so no credentials are attached.
func (s *BackendService) get(path string, out interface{}) error {
	req, err := http.NewRequest(http.MethodGet, s.cfg.BackendURL+"/api/v1"+path, nil)
	if err != nil {
		return err
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("backend %s returned status %d: %s", path, resp.StatusCode, string(body))
	}

	return json.Unmarshal(body, out)
}

// GetAnime fetches GET /api/v1/anime/:slug. Addressed by slug, not a
// numeric id — this app never used numeric anime ids.
func (s *BackendService) GetAnime(slug string) (*models.AnimeDetail, error) {
	var anime models.AnimeDetail
	if err := s.get("/anime/"+url.PathEscape(slug), &anime); err != nil {
		return nil, err
	}
	return &anime, nil
}

// GetWatchBootstrap fetches GET /api/v1/episodes/:episodeId — the episode,
// its anime, and adjacency in one call. episodeId is a UUID; there is no
// separate animeId parameter, since the backend resolves the anime from
// the episode itself (see watch.service.ts's doc comment for why the old
// two-parameter route was removed).
func (s *BackendService) GetWatchBootstrap(episodeID string) (*models.WatchBootstrap, error) {
	var bootstrap models.WatchBootstrap
	if err := s.get("/episodes/"+url.PathEscape(episodeID), &bootstrap); err != nil {
		return nil, err
	}
	return &bootstrap, nil
}

// GetTranslatorGroup fetches GET /api/v1/translators/:slug. Addressed by
// slug, not a numeric id.
func (s *BackendService) GetTranslatorGroup(slug string) (*models.TranslatorGroup, error) {
	var group models.TranslatorGroup
	if err := s.get("/translators/"+url.PathEscape(slug), &group); err != nil {
		return nil, err
	}
	return &group, nil
}

// GetPublicProfile fetches GET /api/v1/profiles/:username.
func (s *BackendService) GetPublicProfile(username string) (*models.PublicProfile, error) {
	var profile models.PublicProfile
	if err := s.get("/profiles/"+url.PathEscape(username), &profile); err != nil {
		return nil, err
	}
	return &profile, nil
}
