package handlers

import (
	"regexp"
	"strings"
)

// Default meta tag values shared across handlers
const (
	defaultTitle       = "playanime"
	defaultDescription = "Oglądaj najlepsze anime online za darmo z polskimi napisami i dubbingiem. Tysiące odcinków anime, mangi i seriali w wysokiej jakości. Społeczność fanów anime w Polsce."
	defaultOGType      = "website"
	defaultOGURL       = "https://playani.me"
	defaultOGImage     = "https://playani.me/og-image.jpg"
)

// removeHeadComments removes HTML comments from the <head> section only
func removeHeadComments(html string) string {
	// Find the head section
	headStart := strings.Index(html, "<head")
	if headStart == -1 {
		return html
	}

	headEnd := strings.Index(html[headStart:], "</head>")
	if headEnd == -1 {
		return html
	}
	headEnd += headStart

	// Extract head, body and before sections
	before := html[:headStart]
	head := html[headStart:headEnd]
	after := html[headEnd:]

	// Remove comments from head section only
	commentRegex := regexp.MustCompile(`<!--[\s\S]*?-->`)
	head = commentRegex.ReplaceAllString(head, "")

	return before + head + after
}
