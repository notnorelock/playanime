package models

// SessionUser mirrors SessionUser in packages/contracts/src/auth/index.ts —
// what GET /api/v1/auth/me returns as its `user` field. There is no bearer
// token anywhere in this app: the session is an HttpOnly cookie
// (playanime_session by default), and this server authenticates by
// forwarding that cookie to the backend, never by verifying a token itself.
type SessionUser struct {
	ID            string  `json:"id"`
	Email         string  `json:"email"`
	Username      string  `json:"username"`
	DisplayName   *string `json:"displayName"`
	Avatar        *string `json:"avatar"`
	Role          string  `json:"role"` // "user" | "moderator" | "admin"
	EmailVerified bool    `json:"emailVerified"`
}

// IsAtLeast reports whether the user's role meets or exceeds required,
// mirroring hasAtLeastRole() / ROLE_RANK in
// packages/contracts/src/auth/index.ts. Kept here rather than a bare
// equality check because "admin" must also satisfy an "at least moderator"
// gate.
func (u *SessionUser) IsAtLeast(required string) bool {
	rank := map[string]int{"user": 0, "moderator": 10, "admin": 20}
	actual, ok := rank[u.Role]
	if !ok {
		return false
	}
	need, ok := rank[required]
	if !ok {
		return false
	}
	return actual >= need
}

// PublicProfile mirrors PublicProfile in
// packages/contracts/src/social/index.ts — what
// GET /api/v1/profiles/:username returns. Addressed by username, not a
// numeric id.
type PublicProfile struct {
	UserID      string  `json:"userId"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
	Bio         *string `json:"bio"`
	Pronouns    *string `json:"pronouns"`
	Avatar      *string `json:"avatar"`
	Banner      *string `json:"banner"`
}
