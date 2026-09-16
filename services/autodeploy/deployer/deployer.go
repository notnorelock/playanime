// Package deployer is the one place that actually pulls and deploys, and
// owns the approval-gate state machine: poll finds new commits -> post/
// update a pending approval in Discord's private channel -> a dev-role
// member clicks Approve (deploy) or Skip (acknowledge without deploying).
// /deploy (an explicit human command) bypasses the gate entirely — running
// the command already is the approval.
package deployer

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"playanime/autodeploy/config"
	"playanime/autodeploy/deploy"
	"playanime/autodeploy/git"
	"playanime/autodeploy/state"
)

// Notifier is the subset of notify.Bot/notify.Discord the deployer needs —
// an interface here (not the concrete notify types) so this package
// doesn't have to import notify at all, which keeps the dependency
// direction one-way: main.go wires concrete notify types in, deployer
// never reaches back out to know about Discord specifics beyond this.
type Notifier interface {
	// PostOrUpdateApproval shows (or refreshes, if messageID is non-empty)
	// the pending-approval message with a changelog and Approve/Skip
	// buttons. Returns the message ID so it can be persisted and updated
	// again later (e.g. a newer commit arrives while one is still pending).
	PostOrUpdateApproval(ctx context.Context, messageID string, commits []git.Commit, targetCommit string) (newMessageID string, err error)
	// ResolveApproval edits the pending message to show its outcome
	// (approved+deploying, or skipped) and removes the buttons.
	ResolveApproval(ctx context.Context, messageID string, approved bool) error
	// PostReport sends the build-report embed (pull/build/deploy steps,
	// commit, author, duration) to the public channel, and the same plus
	// full output-on-failure to the private channel.
	PostReport(ctx context.Context, report Report) error
	// PostPollError notifies (deduped by the caller) that checking for
	// updates itself failed.
	PostPollError(ctx context.Context, err error) error
}

// Report is what PostReport renders — kept independent of deploy.Result so
// notify doesn't need to import the deploy package either.
type Report struct {
	CommitHash    string
	CommitSubject string
	Author        string
	Success       bool
	Duration      time.Duration
	Output        string
}

type Status struct {
	LastCheckedAt       time.Time
	LastDeployedCommit  string
	LastDeployedAt      time.Time
	LastDeploySucceeded bool
	LastDeployOutput    string
	InProgress          bool
	// PendingCommit is non-empty when an approval request is currently
	// outstanding.
	PendingCommit string
}

type Deployer struct {
	repo     *git.Repo
	branch   string
	cfg      *config.Config
	store    *state.Store
	notifier Notifier // nil in webhook-only fallback mode — see main.go

	mu               sync.Mutex
	inProgress       bool
	lastPollErrorMsg string
	lastReport       Report
}

func New(repo *git.Repo, branch string, cfg *config.Config, store *state.Store, notifier Notifier) *Deployer {
	return &Deployer{repo: repo, branch: branch, cfg: cfg, store: store, notifier: notifier}
}

func (d *Deployer) StatusSnapshot() Status {
	s := d.store.Get()
	d.mu.Lock()
	inProgress := d.inProgress
	d.mu.Unlock()

	deployedAt := time.Time{}
	if s.LastDeployedAt != "" {
		if t, err := time.Parse(time.RFC3339, s.LastDeployedAt); err == nil {
			deployedAt = t
		}
	}

	return Status{
		LastDeployedCommit:  s.LastDeployedCommit,
		LastDeployedAt:      deployedAt,
		LastDeploySucceeded: s.LastDeploySucceeded,
		LastDeployOutput:    s.LastDeployOutput,
		InProgress:          inProgress,
		PendingCommit:       s.PendingCommit,
	}
}

// Poll checks for new commits since the last acknowledged one. With no
// notifier configured (webhook-only fallback mode), it deploys
// immediately, same as autodeploy's original always-auto behavior. With a
// notifier, it posts/refreshes the pending approval instead of deploying —
// Approve/Skip (see the two methods below) are what actually advance
// things from there.
func (d *Deployer) Poll(ctx context.Context) error {
	remoteHead, newCommits, err := d.checkForUpdates(ctx)
	if err != nil {
		return err
	}
	if remoteHead == "" {
		return nil // up to date, nothing pending
	}

	if d.notifier == nil {
		return d.deployTo(ctx, remoteHead)
	}

	s := d.store.Get()
	messageID, err := d.notifier.PostOrUpdateApproval(ctx, s.PendingMessageID, newCommits, remoteHead)
	if err != nil {
		return fmt.Errorf("posting approval request: %w", err)
	}

	return d.store.Update(func(st *state.State) {
		st.PendingCommit = remoteHead
		st.PendingMessageID = messageID
		// PendingChannelID unchanged — PostOrUpdateApproval always targets
		// the same configured private channel, so it never needs updating.
	})
}

// checkForUpdates fetches and diffs origin/branch against the acknowledged
// baseline, returning the new HEAD and its changelog — or ("", nil, nil)
// if there's nothing new. Never mutates git state beyond the fetch.
func (d *Deployer) checkForUpdates(ctx context.Context) (remoteHead string, newCommits []git.Commit, err error) {
	remoteHead, err = d.repo.RemoteHead(ctx, d.branch)
	if err != nil {
		wrapped := fmt.Errorf("checking remote HEAD: %w", err)
		d.notifyPollError(ctx, wrapped)
		return "", nil, wrapped
	}
	d.clearPollError()

	s := d.store.Get()
	if s.AcknowledgedCommit == remoteHead {
		return "", nil, nil
	}

	newCommits, err = d.repo.Log(ctx, s.AcknowledgedCommit, remoteHead)
	if err != nil {
		return "", nil, fmt.Errorf("listing new commits: %w", err)
	}
	return remoteHead, newCommits, nil
}

// Approve pulls and deploys up to targetCommit, then resolves the pending
// approval message. Called from the private channel's Approve button.
func (d *Deployer) Approve(ctx context.Context, targetCommit string) error {
	s := d.store.Get()
	messageID := s.PendingMessageID

	if err := d.deployTo(ctx, targetCommit); err != nil {
		return err
	}
	if d.notifier != nil && messageID != "" {
		if err := d.notifier.ResolveApproval(ctx, messageID, true); err != nil {
			log.Printf("resolving approval message: %v", err)
		}
	}
	return nil
}

// Skip acknowledges targetCommit without deploying it — the next poll
// won't propose it (or anything at or before it) again.
func (d *Deployer) Skip(ctx context.Context, targetCommit string) error {
	s := d.store.Get()
	messageID := s.PendingMessageID

	if err := d.store.Update(func(st *state.State) {
		st.AcknowledgedCommit = targetCommit
		st.PendingCommit = ""
		st.PendingMessageID = ""
		st.PendingChannelID = ""
	}); err != nil {
		return fmt.Errorf("persisting skip: %w", err)
	}

	if d.notifier != nil && messageID != "" {
		if err := d.notifier.ResolveApproval(ctx, messageID, false); err != nil {
			log.Printf("resolving skip message: %v", err)
		}
	}
	return nil
}

// DeployNow is /deploy's entry point: check for updates and deploy
// immediately if there are any, bypassing the approval gate entirely (the
// command itself is the approval — a dev-role member explicitly asked for
// this). Returns deployed=false with no error if already up to date.
func (d *Deployer) DeployNow(ctx context.Context) (deployed bool, result deploy.Result, err error) {
	remoteHead, _, err := d.checkForUpdates(ctx)
	if err != nil {
		return false, deploy.Result{}, err
	}
	if remoteHead == "" {
		return false, deploy.Result{}, nil
	}

	s := d.store.Get()
	pendingMessageID := s.PendingMessageID

	if err := d.deployTo(ctx, remoteHead); err != nil {
		return false, deploy.Result{}, err
	}

	if d.notifier != nil && pendingMessageID != "" {
		if err := d.notifier.ResolveApproval(ctx, pendingMessageID, true); err != nil {
			log.Printf("resolving approval message: %v", err)
		}
	}

	return true, d.lastResult(), nil
}

// deployTo pulls to targetCommit and runs deploy.sh, persisting the
// outcome and posting the build report. Callers (Approve, DeployNow) are
// responsible for resolving any pending approval message afterward —
// deployTo itself only deploys and reports.
func (d *Deployer) deployTo(ctx context.Context, targetCommit string) error {
	d.mu.Lock()
	if d.inProgress {
		d.mu.Unlock()
		return fmt.Errorf("a deploy is already in progress")
	}
	d.inProgress = true
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		d.inProgress = false
		d.mu.Unlock()
	}()

	if err := d.repo.Pull(ctx, d.branch); err != nil {
		return fmt.Errorf("pulling %s: %w", targetCommit, err)
	}

	commits, err := d.repo.Log(ctx, "", targetCommit)
	author, subject := "", ""
	if err == nil && len(commits) > 0 {
		last := commits[len(commits)-1]
		author, subject = last.Author, last.Subject
	}

	result := deploy.Run(ctx, d.cfg.RepoPath, d.cfg.DeployScriptPath(), d.cfg.DeployTimeout())

	deployedAt := time.Now()
	if err := d.store.Update(func(st *state.State) {
		st.AcknowledgedCommit = targetCommit
		st.LastDeployedCommit = targetCommit
		st.LastDeployedAt = deployedAt.Format(time.RFC3339)
		st.LastDeploySucceeded = result.Success
		st.LastDeployOutput = result.Output
		st.PendingCommit = ""
		st.PendingMessageID = ""
		st.PendingChannelID = ""
	}); err != nil {
		log.Printf("persisting deploy result: %v", err)
	}

	d.mu.Lock()
	d.lastReport = Report{
		CommitHash:    targetCommit,
		CommitSubject: subject,
		Author:        author,
		Success:       result.Success,
		Duration:      result.Duration,
		Output:        result.Output,
	}
	d.mu.Unlock()

	if d.notifier != nil {
		if err := d.notifier.PostReport(ctx, d.lastReportSnapshot()); err != nil {
			log.Printf("posting deploy report: %v", err)
		}
	}

	if result.Success {
		return nil
	}
	return fmt.Errorf("deploy.sh failed after %s", result.Duration.Round(time.Second))
}

func (d *Deployer) lastResult() deploy.Result {
	d.mu.Lock()
	defer d.mu.Unlock()
	return deploy.Result{Success: d.lastReport.Success, Output: d.lastReport.Output, Duration: d.lastReport.Duration}
}

func (d *Deployer) lastReportSnapshot() Report {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.lastReport
}

func (d *Deployer) notifyPollError(ctx context.Context, err error) {
	msg := err.Error()

	d.mu.Lock()
	alreadyNotified := d.lastPollErrorMsg == msg
	d.lastPollErrorMsg = msg
	d.mu.Unlock()

	if alreadyNotified || d.notifier == nil {
		return
	}
	if notifyErr := d.notifier.PostPollError(ctx, err); notifyErr != nil {
		log.Printf("posting poll error: %v", notifyErr)
	}
}

func (d *Deployer) clearPollError() {
	d.mu.Lock()
	d.lastPollErrorMsg = ""
	d.mu.Unlock()
}
