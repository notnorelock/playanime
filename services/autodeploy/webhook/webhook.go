// Package webhook is autodeploy's GitHub webhook listener: a fast trigger
// that tells autodeploy to check for updates the instant a push lands,
// instead of waiting for the next scheduled poll (see config.WebhookConfig
// and main.go). It does not replace polling — that keeps running as a
// fallback for a dropped delivery, a misconfigured secret, or GitHub
// itself being unreachable — and it does not trust the webhook payload for
// anything beyond "which branch was pushed to": the actual set of new
// commits and what changed in them is always established by Deployer.Poll
// calling straight through to git (see deployer/deployer.go), exactly as
// it already does for a scheduled poll. This keeps one code path
// responsible for "what actually changed", rather than a second,
// payload-trusting path that could disagree with it.
package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// Poller is the subset of *deployer.Deployer this package needs — an
// interface (not the concrete type) purely so this package's own tests
// don't need a real Deployer (git repo, state file, etc.) to construct.
type Poller interface {
	Poll(ctx context.Context) error
}

// Server is the loopback-only HTTP listener. Never bind this to a public
// interface — see NewServer's own doc comment for why loopback is a second
// layer of protection independent of the firewall/Caddy routing that's
// meant to be the only thing reaching it.
type Server struct {
	http   *http.Server
	secret []byte
	branch string
	poller Poller
}

// NewServer builds (but does not start — see Start) the webhook listener.
// secret is the shared secret configured on the GitHub webhook itself
// (must be non-empty — config.Load already refuses to start otherwise);
// branch is the tracked branch (matches config.Config's own Branch/main.go's
// resolved current-branch fallback) — a push to any other ref is
// acknowledged (200) but does not trigger a poll.
//
// Binds 127.0.0.1:port specifically, not 0.0.0.0 — the only thing meant to
// reach this is Caddy, itself reachable only through Cloudflare's IP
// ranges (see infrastructure/docker/update-cloudflare-firewall.sh) and
// proxying in from inside the Docker network via the host-gateway bridge
// (see infrastructure/docker/Caddyfile's ci.playani.me block).
// Binding loopback means even a firewall or Caddy-config mistake can't
// expose this port directly to the internet — defense in depth, not the
// only layer.
func NewServer(port int, secret, branch string, poller Poller) *Server {
	s := &Server{
		secret: []byte(secret),
		branch: branch,
		poller: poller,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/github", s.handleGitHub)

	s.http = &http.Server{
		Addr:              fmt.Sprintf("127.0.0.1:%d", port),
		Handler:           mux,
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		// WriteTimeout is deliberately generous, not zero — handleGitHub's
		// own response is written almost immediately (Poll runs in a
		// detached goroutine, see below), but a slow client on the other
		// end of a loopback proxy connection (Caddy under load) shouldn't
		// have its response cut off mid-write.
		WriteTimeout: 30 * time.Second,
	}

	return s
}

// Start runs the listener until ctx is cancelled, then shuts it down
// gracefully. Meant to run in its own goroutine — see main.go.
func (s *Server) Start(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		if err := s.http.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("webhook server: %w", err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return s.http.Shutdown(shutdownCtx)
	}
}

// githubPushPayload is deliberately minimal — only the one field this
// package actually reads. GitHub's real push payload has dozens of fields
// (commits, pusher, repository, compare URL, ...); none of them are
// trusted here, see the package doc comment for why. A field this handler
// doesn't declare is simply ignored by json.Unmarshal, not an error.
type githubPushPayload struct {
	Ref string `json:"ref"`
}

func (s *Server) handleGitHub(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Capped read: a webhook delivery is a small JSON document (well under
	// 1MB even for a large push) — an unbounded io.ReadAll on a request
	// this endpoint doesn't otherwise authenticate before reading the body
	// would let anyone who can reach it (in principle just Caddy, per
	// NewServer's doc comment, but this is cheap insurance regardless)
	// hand it an arbitrarily large body before the signature check below
	// ever gets to reject it.
	const maxBodyBytes = 5 << 20 // 5MB
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	if len(body) > maxBodyBytes {
		http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
		return
	}

	if !s.verifySignature(r.Header.Get("X-Hub-Signature-256"), body) {
		log.Printf("webhook: rejected delivery with invalid or missing signature from %s", r.RemoteAddr)
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}

	eventType := r.Header.Get("X-GitHub-Event")
	if eventType == "ping" {
		// GitHub sends this once, when the webhook is first created (or
		// "Redeliver" is used from the UI) — no ref, nothing to poll for,
		// just confirms the endpoint and secret are reachable/correct.
		w.WriteHeader(http.StatusOK)
		return
	}
	if eventType != "push" {
		// Acknowledged, not an error — this endpoint is configured for
		// "Just the push event" on the GitHub side (see README.md), but a
		// stray event type reaching it anyway (a misconfigured webhook)
		// should not look like a failure in GitHub's delivery log.
		w.WriteHeader(http.StatusOK)
		return
	}

	var payload githubPushPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "malformed payload", http.StatusBadRequest)
		return
	}

	// refs/heads/<branch> is the format GitHub sends for a normal branch
	// push (as opposed to a tag push, refs/tags/...).
	pushedBranch := strings.TrimPrefix(payload.Ref, "refs/heads/")
	if pushedBranch != s.branch {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Respond immediately — GitHub expects a delivery to complete quickly
	// (it has its own short timeout and will mark a slow delivery as
	// failed), but a real deploy can take minutes. Poll itself already
	// no-ops correctly if a deploy is already in progress (see
	// deployer.Deployer.inProgress) or if there's genuinely nothing new
	// (checkForUpdates), so firing it in a detached goroutine here is safe
	// even if a scheduled poll is mid-flight or a second delivery arrives
	// moments later.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		if err := s.poller.Poll(ctx); err != nil {
			log.Printf("webhook-triggered poll failed: %v", err)
		}
	}()

	w.WriteHeader(http.StatusOK)
}

// verifySignature checks header against a fresh HMAC-SHA256 of body,
// computed with s.secret — see the package doc comment for GitHub's exact
// "sha256=" + hex(...) format. Uses hmac.Equal (constant-time) rather than
// a plain string/byte comparison, which would leak timing information
// about how many leading bytes of a guessed signature matched.
func (s *Server) verifySignature(header string, body []byte) bool {
	const prefix = "sha256="
	if !strings.HasPrefix(header, prefix) {
		return false
	}

	got, err := hex.DecodeString(strings.TrimPrefix(header, prefix))
	if err != nil {
		return false
	}

	mac := hmac.New(sha256.New, s.secret)
	mac.Write(body)
	want := mac.Sum(nil)

	return hmac.Equal(got, want)
}
