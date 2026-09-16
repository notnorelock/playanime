// Package state persists autodeploy's approval workflow across restarts —
// which commit is the last acknowledged one (deployed or explicitly
// skipped), and which Discord message is currently showing a pending
// Approve/Skip request, if any. Without this, a restart mid-approval would
// forget a pending commit ever needed a decision, and forget what was last
// deployed for /status.
package state

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// State is the full on-disk shape — deliberately small and flat, since
// this is read/written whole on every change, not queried piecemeal.
type State struct {
	// AcknowledgedCommit is the commit hash the approval workflow
	// considers "caught up to" — either the last one actually deployed, or
	// the last one a human explicitly Skipped. The next poll only proposes
	// commits newer than this.
	AcknowledgedCommit string `json:"acknowledgedCommit"`
	// PendingMessageID is the Discord message ID of the current
	// outstanding Approve/Skip request, empty when nothing is pending.
	// Needed so a restart can find and update the existing message
	// (e.g. if a newer commit arrives) instead of losing track of it.
	PendingMessageID string `json:"pendingMessageId"`
	// PendingChannelID is which channel PendingMessageID lives in.
	PendingChannelID string `json:"pendingChannelId"`
	// PendingCommit is the commit hash the pending request is asking about
	// — the "up to here" target if Approved.
	PendingCommit string `json:"pendingCommit"`

	// LastDeployedCommit/At/Succeeded/Output back /status. Separate from
	// AcknowledgedCommit because a Skip advances the latter without ever
	// deploying anything — /status should keep reporting the last commit
	// that was actually built and started, not one that was only skipped.
	LastDeployedCommit  string `json:"lastDeployedCommit"`
	LastDeployedAt      string `json:"lastDeployedAt"` // RFC3339; string so a zero value serializes as "" not a magic date
	LastDeploySucceeded bool   `json:"lastDeploySucceeded"`
	LastDeployOutput    string `json:"lastDeployOutput"`
}

// Store wraps State with the file it's persisted to and a mutex, so every
// caller in this daemon (poll loop, button handlers, /status) reads and
// writes through one serialized path — two goroutines racing to write this
// file is exactly the kind of bug that corrupts state invisibly until a
// restart surfaces it as "how did we lose the pending approval."
type Store struct {
	path string
	mu   sync.Mutex
	data State
}

// Open loads path if it exists, or starts from a zero State if this is the
// first run against this repo (no prior acknowledged commit — the next
// poll will treat every commit as new, per Log's empty-fromRef behavior).
func Open(path string) (*Store, error) {
	s := &Store{path: path}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading state file %s: %w", path, err)
	}

	if err := json.Unmarshal(data, &s.data); err != nil {
		return nil, fmt.Errorf("parsing state file %s: %w", path, err)
	}
	return s, nil
}

// Get returns a copy of the current state.
func (s *Store) Get() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data
}

// Update applies fn to the state and persists the result atomically (write
// to a temp file, then rename — so a crash mid-write never leaves a
// truncated, unparseable state file behind for the next restart to choke
// on).
func (s *Store) Update(fn func(*State)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	fn(&s.data)

	encoded, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding state: %w", err)
	}

	tmpPath := s.path + ".tmp"
	if err := os.WriteFile(tmpPath, encoded, 0o600); err != nil {
		return fmt.Errorf("writing state temp file: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		return fmt.Errorf("renaming state temp file: %w", err)
	}
	return nil
}
