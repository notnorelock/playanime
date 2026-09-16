package models

// TranslatorGroup mirrors the fields of TranslatorGroupSummary (a prefix of
// TranslatorGroupDetail, which is what GET /api/v1/translators/:slug
// actually returns) that this server's OG tags need. Addressed by slug, not
// a numeric id.
type TranslatorGroup struct {
	ID          string    `json:"id"`
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	Avatar      *ImageRef `json:"avatar"`
	IsVerified  bool      `json:"isVerified"`
}
