// Package notify sends deploy results to a Discord webhook.
package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Discord struct {
	WebhookURL string
	Client     *http.Client
}

func NewDiscord(webhookURL string) *Discord {
	return &Discord{
		WebhookURL: webhookURL,
		Client:     &http.Client{Timeout: 10 * time.Second},
	}
}

type webhookPayload struct {
	Content string         `json:"content"`
	Embeds  []webhookEmbed `json:"embeds,omitempty"`
}

type webhookEmbed struct {
	Title       string              `json:"title"`
	Description string              `json:"description,omitempty"`
	Color       int                 `json:"color"`
	Fields      []webhookEmbedField `json:"fields,omitempty"`
	Timestamp   string              `json:"timestamp"`
}

type webhookEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline"`
}

const (
	colorGreen  = 0x2ecc71
	colorRed    = 0xe74c3c
	colorYellow = 0xf1c40f
	// Discord embed field values are capped at 1024 characters — truncate
	// deploy output rather than let a failed post silently drop the whole
	// notification.
	maxFieldLength = 1000
)

// DeploySucceeded posts a short success notice — no output attached, since
// the common case needs no debugging and a wall of green build log is
// noise in a channel meant to be skimmed.
func (d *Discord) DeploySucceeded(commitHash string, duration string) error {
	if d.WebhookURL == "" {
		return nil
	}
	return d.post(webhookPayload{
		Embeds: []webhookEmbed{{
			Title:       "✅ Deploy succeeded",
			Description: fmt.Sprintf("Deployed `%s` in %s", shortHash(commitHash), duration),
			Color:       colorGreen,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

// DeployFailed posts a failure notice with the tail of deploy.sh's output,
// so the first thing anyone sees is enough to start diagnosing without
// needing to SSH in immediately.
func (d *Discord) DeployFailed(commitHash string, duration string, output string) error {
	if d.WebhookURL == "" {
		return nil
	}
	return d.post(webhookPayload{
		Content: "@here",
		Embeds: []webhookEmbed{{
			Title:       "❌ Deploy failed",
			Description: fmt.Sprintf("Failed deploying `%s` after %s", shortHash(commitHash), duration),
			Color:       colorRed,
			Fields: []webhookEmbedField{
				{Name: "Output (tail)", Value: "```\n" + truncateTail(output, maxFieldLength-8) + "\n```"},
			},
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

// PollError posts when checking for new commits itself fails (e.g. the
// GitHub token expired, network trouble) — distinct from a deploy failure
// because nothing was actually deployed, so silence here would otherwise
// look identical to "no new commits" and hide a real problem indefinitely.
func (d *Discord) PollError(err error) error {
	if d.WebhookURL == "" {
		return nil
	}
	return d.post(webhookPayload{
		Embeds: []webhookEmbed{{
			Title:       "⚠️ autodeploy couldn't check for updates",
			Description: "```\n" + truncateTail(err.Error(), maxFieldLength) + "\n```",
			Color:       colorRed,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

func (d *Discord) post(payload webhookPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshaling discord payload: %w", err)
	}

	resp, err := d.Client.Post(d.WebhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("posting to discord: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("discord webhook returned status %d", resp.StatusCode)
	}
	return nil
}

func shortHash(hash string) string {
	if len(hash) > 7 {
		return hash[:7]
	}
	return hash
}

// truncateTail keeps the end of the string, not the start — the error
// that actually explains a failure is almost always the last thing
// printed, not the first.
func truncateTail(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return "...(truncated)...\n" + s[len(s)-max:]
}
