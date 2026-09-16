package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"playanime/server/config"
	"playanime/server/models"
)

// AuthService resolves the current session by forwarding the session
// cookie to the backend — there is no bearer token anywhere in this app.
// Sessions are HttpOnly cookies (see sessionCookieAttributes() in
// packages/auth/src/cookies.ts); the token itself is opaque and
// meaningless to verify locally, so this always asks the backend, the
// same as any browser request would.
type AuthService struct {
	cfg    *config.Config
	client *http.Client
}

func NewAuthService(cfg *config.Config) *AuthService {
	return &AuthService{cfg: cfg, client: &http.Client{}}
}

// VerifySession calls GET /api/v1/auth/me with the given session cookie
// value attached under its real cookie name (SESSION_COOKIE_NAME,
// "playanime_session" by default) and returns the signed-in user, or an
// error if the cookie is missing, expired, or revoked.
func (s *AuthService) VerifySession(sessionCookieName, sessionToken string) (*models.SessionUser, error) {
	req, err := http.NewRequest(http.MethodGet, s.cfg.BackendURL+"/api/v1/auth/me", nil)
	if err != nil {
		return nil, err
	}

	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sessionToken})

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("session check returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// GET /auth/me responds { user: SessionUser }, not the user object
	// directly — see auth.controller.ts.
	var envelope struct {
		User models.SessionUser `json:"user"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, err
	}

	return &envelope.User, nil
}
