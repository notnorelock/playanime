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

// FileChangeStatus is one of Added/Modified/Removed/Renamed — the four
// shapes `git diff --name-status` actually reports on a normal source
// change (Copied is real but rare enough in an ordinary push history that
// it's folded into Modified rather than given its own symbol here).
type FileChangeStatus string

const (
	FileAdded    FileChangeStatus = "added"
	FileModified FileChangeStatus = "modified"
	FileRemoved  FileChangeStatus = "removed"
	FileRenamed  FileChangeStatus = "renamed"
)

// FileChange is one file's line in a diff summary.
type FileChange struct {
	Status FileChangeStatus
	Path   string
	// OldPath is set only for FileRenamed — the path it was renamed from.
	OldPath string
}

// Symbol is the single-character marker this package uses everywhere it
// renders a FileChange list (Discord embeds, log lines) — the "+/-/~"
// shape the caller asked for: + added, - removed, ~ changed (modified or
// renamed; a rename is still "the same file changed location", not a
// distinct third symbol worth a reader parsing).
func (c FileChange) Symbol() string {
	switch c.Status {
	case FileAdded:
		return "+"
	case FileRemoved:
		return "-"
	default: // FileModified, FileRenamed
		return "~"
	}
}

// DiffStat summarizes which files changed between fromRef and toRef —
// e.g. DiffStat(ctx, "abc123", "def456") for the exact same range a
// changelog (Log, above) would cover, so a caller can show "N commits
// touching M files" with a per-file +/-/~ breakdown rather than only the
// commit-message list Log provides. fromRef must be non-empty (unlike
// Log) — a diff needs two real endpoints; there is no meaningful "diff
// since the beginning of history" for a changelog use case like this.
func (r *Repo) DiffStat(ctx context.Context, fromRef, toRef string) ([]FileChange, error) {
	if fromRef == "" {
		return nil, fmt.Errorf("DiffStat: fromRef must not be empty")
	}

	// -M detects renames (default threshold, ~50% similarity) so a
	// rename-only change reports as one FileRenamed entry instead of a
	// misleading FileRemoved+FileAdded pair for what's really one file.
	out, err := r.run(ctx, "diff", "--name-status", "-M", fromRef+".."+toRef)
	if err != nil {
		return nil, err
	}
	if out == "" {
		return nil, nil
	}

	var changes []FileChange
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}

		code := fields[0]
		switch {
		case code == "A":
			changes = append(changes, FileChange{Status: FileAdded, Path: fields[1]})
		case code == "D":
			changes = append(changes, FileChange{Status: FileRemoved, Path: fields[1]})
		case strings.HasPrefix(code, "R"):
			// Rename lines are "R100\told\tnew" — three fields, not two.
			if len(fields) < 3 {
				continue
			}
			changes = append(changes, FileChange{Status: FileRenamed, Path: fields[2], OldPath: fields[1]})
		default: // "M" (modified), "C" (copied), or anything else git adds later
			changes = append(changes, FileChange{Status: FileModified, Path: fields[1]})
		}
	}
	return changes, nil
}
