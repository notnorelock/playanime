// Package git wraps the handful of git operations autodeploy needs:
// checking whether the remote has new commits, and pulling them.
package git

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os/exec"
	"strings"
)

type Repo struct {
	// Path is the git working copy's root.
	Path string
	// Branch is the branch to track. Empty means "whatever HEAD currently is".
	Branch string
	// Token is a GitHub PAT with read access to this repo.
	Token string
}

// run executes git in the repo's directory, with GIT_ASKPASS disabled and
// no credential helper invoked — the token is injected per-invocation via
// -c http.extraHeader, never written to .git/config or exposed in a
// process list (unlike embedding it in the remote URL, which both `ps`
// and .git/config would then carry in plaintext).
func (r *Repo) run(ctx context.Context, args ...string) (string, error) {
	authHeader := fmt.Sprintf("Authorization: Basic %s", basicAuth(r.Token))
	fullArgs := append([]string{"-c", "http.extraHeader=" + authHeader}, args...)

	cmd := exec.CommandContext(ctx, "git", fullArgs...)
	cmd.Dir = r.Path

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, stderr.String())
	}
	return strings.TrimSpace(stdout.String()), nil
}

// basicAuth builds the HTTP Basic auth value GitHub expects for a PAT: the
// token as the password against a placeholder username, base64-encoded.
// This is the documented way to authenticate a fine-grained PAT over HTTPS
// without an interactive prompt (github.com/settings/personal-access-tokens
// — any non-empty username works with a PAT; GitHub ignores it).
func basicAuth(token string) string {
	return base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
}

// CurrentBranch returns the branch currently checked out.
func (r *Repo) CurrentBranch(ctx context.Context) (string, error) {
	return r.run(ctx, "rev-parse", "--abbrev-ref", "HEAD")
}

// LocalHead returns the local checkout's current commit hash.
func (r *Repo) LocalHead(ctx context.Context) (string, error) {
	return r.run(ctx, "rev-parse", "HEAD")
}

// RemoteHead fetches the given branch and returns its tip commit hash,
// without changing the local checkout at all — this is the "check" half
// of poll-then-pull, kept separate so a poll that finds nothing new
// touches no files.
func (r *Repo) RemoteHead(ctx context.Context, branch string) (string, error) {
	if _, err := r.run(ctx, "fetch", "--quiet", "origin", branch); err != nil {
		return "", err
	}
	return r.run(ctx, "rev-parse", "origin/"+branch)
}

// Pull resets the local branch to match origin, discarding any local
// changes to tracked files. Assumes RemoteHead was already called (so the
// fetch is fresh). This daemon owns this checkout exclusively — a dirty
// tree here (a stray manual edit or permission change made directly on the
// VPS) should never block a deploy, so unlike a plain `merge --ff-only`,
// this always lands on origin's commit.
func (r *Repo) Pull(ctx context.Context, branch string) error {
	_, err := r.run(ctx, "reset", "--hard", "origin/"+branch)
	return err
}

// Commit is one entry in a changelog between two refs.
type Commit struct {
	ShortHash string
	Subject   string
	Author    string
}

// Log lists commits reachable from toRef but not fromRef, oldest first (so
// a changelog reads top-to-bottom in the order they'll actually apply) —
// e.g. Log(ctx, "abc123", "origin/master") after RemoteHead has already
// fetched. fromRef may be empty, meaning "since the beginning" — used the
// first time autodeploy ever runs against a repo, when there is no prior
// acknowledged commit to diff from yet.
func (r *Repo) Log(ctx context.Context, fromRef, toRef string) ([]Commit, error) {
	rangeSpec := toRef
	if fromRef != "" {
		rangeSpec = fromRef + ".." + toRef
	}

	const fieldSep = "\x1f" // unit separator — won't collide with real commit text
	out, err := r.run(ctx, "log", "--reverse", "--format=%h"+fieldSep+"%s"+fieldSep+"%an", rangeSpec)
	if err != nil {
		return nil, err
	}
	if out == "" {
		return nil, nil
	}

	lines := strings.Split(out, "\n")
	commits := make([]Commit, 0, len(lines))
	for _, line := range lines {
		parts := strings.SplitN(line, fieldSep, 3)
		if len(parts) != 3 {
			continue
		}
		commits = append(commits, Commit{ShortHash: parts[0], Subject: parts[1], Author: parts[2]})
	}
	return commits, nil
}
