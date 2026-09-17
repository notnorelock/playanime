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

// PipelineStage is where a single deployTo run currently is — the Go
// analog of a CI pipeline's stage list, reported live via Notifier's
// SendPipelineMessage/UpdatePipelineMessage rather than only at the end
// the way the old single PostReport call did.
type PipelineStage string

const (
	PipelinePulling   PipelineStage = "pulling"
	PipelineBuilding  PipelineStage = "building"
	PipelineDeploying PipelineStage = "deploying"
	PipelineSuccess   PipelineStage = "success"
	PipelineFailed    PipelineStage = "failed"
	// PipelineCancelled is distinct from PipelineFailed: failed means the
	// attempt ran and broke; cancelled means something chose not to (or
	// to stop) proceeding, with nothing having gone wrong on its own —
	// deployTo checks ctx before each stage and reports this outcome if it
	// was cancelled (see the cancel helper in deployTo), the same
	// mechanism a future automated gate (a security scan flags a commit
	// mid-run, say) could use by cancelling the context it was given.
	// Kept as a real, distinctly-rendered pipeline stage rather than
	// folded into Failed with a special-cased message, since "we chose not
	// to" and "it broke" read very differently in an incident channel.
	PipelineCancelled PipelineStage = "cancelled"
)

// StageTiming records when a stage started and (once known) finished.
// FinishedAt is the zero time until the stage completes.
type StageTiming struct {
	StartedAt  time.Time
	FinishedAt time.Time
}

// PipelineState is the live snapshot Notifier's pipeline methods render
// into an embed — passed by value to every call so a tick timer captured
// on the notify side always renders whatever the caller last handed it,
// never a value that could still be mutated out from under it.
type PipelineState struct {
	CommitHash    string
	CommitSubject string
	Author        string
	Branch        string
	StartedAt     time.Time
	Stage         PipelineStage
	// Commits is every commit in this deploy's range (the last acknowledged
	// commit, exclusive, through CommitHash, inclusive), oldest first —
	// unlike CommitSubject/Author above (which describe only the newest
	// one, for the embed's title), this is the full changelog a Notifier
	// can render as a real "N commits" list, matching what the
	// approval-gate message already shows via PostOrUpdateApproval's own
	// commits parameter.
	Commits []git.Commit
	// FileChanges is every file touched across the whole Commits range
	// (git.Repo.DiffStat), for a Notifier that wants to show what actually
	// changed — see git.FileChange.Symbol() for the +/-/~ rendering this
	// is meant to drive.
	FileChanges []git.FileChange
	// Timings is nil-checked defensively by callers — always populated for
	// Pulling/Building/Deploying by deployTo, but a Notifier implementation
	// should not assume every stage key is present (e.g. Deploying's
	// timing does not exist yet while Stage is still Building).
	Timings map[PipelineStage]*StageTiming
	Error   string
	// MessageIDs is channelID -> messageID for every channel the initial
	// SendPipelineMessage call posted to — mirrors the reference project's
	// own discordMessages list. Populated by deployTo after
	// SendPipelineMessage returns, then passed back on every subsequent
	// Update call so the Notifier knows which messages to edit.
	MessageIDs map[string]string
	// FailedStage names which of Pulling/Building/Deploying was actually
	// running when Stage became Failed — Stage itself becomes Failed (not
	// e.g. still Building), so a Notifier rendering per-stage fields needs
	// this separately to know which one to mark failed rather than
	// pending. Empty/unset whenever Stage isn't Failed.
	FailedStage PipelineStage
}

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
	// PostPollError notifies (deduped by the caller) that checking for
	// updates itself failed.
	PostPollError(ctx context.Context, err error) error

	// SendPipelineMessage posts the initial live-progress embed (stage
	// Pulling, every later stage shown as pending) before any real work
	// has started, to every configured channel. Returns the sent message
	// IDs keyed by channel ID, to store on PipelineState.MessageIDs.
	SendPipelineMessage(ctx context.Context, s PipelineState) (map[string]string, error)
	// UpdatePipelineMessage edits the messages named by s.MessageIDs to
	// reflect s's current stage/timings/error — called on every real
	// stage transition AND by the periodic tick (see StartPipelineTick),
	// so both funnel through the same per-message edit ordering.
	UpdatePipelineMessage(ctx context.Context, s PipelineState) error
	// StartPipelineTick begins periodically re-rendering s's messages
	// (elapsed-time-only, no state change) until StopPipelineTick is
	// called for the same MessageIDs — keeps the embed visibly live
	// between real transitions. A no-op if s.MessageIDs is empty (e.g.
	// SendPipelineMessage itself failed to post anywhere).
	StartPipelineTick(s PipelineState)
	// StopPipelineTick ends the periodic re-render started above. Safe to
	// call even if no tick is running for these MessageIDs.
	StopPipelineTick(s PipelineState)
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
	lastResultSnap   deploy.Result
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
// outcome and reporting live progress through Notifier's pipeline methods
// as it goes. Callers (Approve, DeployNow) are responsible for resolving
// any pending approval message afterward — deployTo itself only deploys
// and reports.
//
// Mirrors a CI pipeline's own stageStart/stageFinish/update shape: build a
// PipelineState, post it, then advance it through Pulling -> Building ->
// Deploying (the latter two driven by deploy.Run's onStage callback, since
// deploy.sh itself owns exactly when those transitions happen) ending in
// Success or Failed, updating the live message at every real transition
// plus a periodic tick in between.
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

	// The range is [last acknowledged commit, targetCommit] — NOT "from
	// the beginning of history", which an earlier version of this call
	// used by passing an empty fromRef; that meant every deploy re-fetched
	// and discarded the entire repo's commit log just to read the newest
	// entry. AcknowledgedCommit is exactly what checkForUpdates already
	// diffs against for the approval message's own changelog, so this is
	// the same range, computed the same way, just also needed here for
	// the live pipeline message.
	previouslyAcknowledged := d.store.Get().AcknowledgedCommit

	commits, logErr := d.repo.Log(ctx, previouslyAcknowledged, targetCommit)
	if logErr != nil {
		log.Printf("listing commits for pipeline message: %v", logErr)
	}

	author, subject := "", ""
	if len(commits) > 0 {
		last := commits[len(commits)-1]
		author, subject = last.Author, last.Subject
	}

	var fileChanges []git.FileChange
	if previouslyAcknowledged != "" {
		// DiffStat needs a real non-empty fromRef (see its own doc
		// comment) — the very first deploy autodeploy ever makes for a
		// repo has no prior acknowledged commit to diff from, so file
		// changes are simply omitted that one time rather than guessing a
		// range.
		changes, diffErr := d.repo.DiffStat(ctx, previouslyAcknowledged, targetCommit)
		if diffErr != nil {
			log.Printf("computing file changes for pipeline message: %v", diffErr)
		} else {
			fileChanges = changes
		}
	}

	pipeline := PipelineState{
		CommitHash:    targetCommit,
		CommitSubject: subject,
		Author:        author,
		Branch:        d.branch,
		StartedAt:     time.Now(),
		Stage:         PipelinePulling,
		Timings:       map[PipelineStage]*StageTiming{},
		Commits:       commits,
		FileChanges:   fileChanges,
	}

	if d.notifier != nil {
		ids, err := d.notifier.SendPipelineMessage(ctx, pipeline)
		if err != nil {
			// A failed initial post is logged, not fatal — the deploy
			// itself must still proceed; a Discord outage should never
			// block shipping code. MessageIDs stays nil, so every later
			// UpdatePipelineMessage/tick call below is a correctly-scoped
			// no-op (nothing to edit).
			log.Printf("posting pipeline message: %v", err)
		} else {
			pipeline.MessageIDs = ids
			d.notifier.StartPipelineTick(pipeline)
			defer d.notifier.StopPipelineTick(pipeline)
		}
	}

	stageStart := func(stage PipelineStage) {
		pipeline.Timings[stage] = &StageTiming{StartedAt: time.Now()}
	}
	stageFinish := func(stage PipelineStage) {
		if t, ok := pipeline.Timings[stage]; ok {
			t.FinishedAt = time.Now()
		}
	}
	update := func(stage PipelineStage, errMsg string) {
		pipeline.Stage = stage
		if errMsg != "" {
			pipeline.Error = errMsg
		}
		if d.notifier != nil && len(pipeline.MessageIDs) > 0 {
			if err := d.notifier.UpdatePipelineMessage(ctx, pipeline); err != nil {
				log.Printf("updating pipeline message: %v", err)
			}
		}
	}
	// fail marks stage as the one that broke and transitions to Failed.
	// Deliberately does NOT call stageFinish(stage) — a "finished" timing
	// and a "failed" timing are different things a Notifier needs to tell
	// apart (see PipelineState.FailedStage's own doc comment), so the
	// failed stage's StageTiming is left with FinishedAt still zero;
	// FailedStage is what actually identifies which field to render as
	// failed, not timing-presence inference.
	fail := func(stage PipelineStage, errMsg string) {
		pipeline.FailedStage = stage
		update(PipelineFailed, errMsg)
	}
	// cancel reports PipelineCancelled the same way fail reports
	// PipelineFailed — used below whenever ctx is cancelled before a
	// stage that hasn't started yet, which today only happens via the
	// caller's own context (e.g. process shutdown mid-deploy); a future
	// gate that wants to stop a run in progress (flag a commit, say) can
	// use the exact same path by cancelling the context it handed to
	// Approve/DeployNow.
	cancel := func(stage PipelineStage, reason string) {
		pipeline.FailedStage = stage
		update(PipelineCancelled, reason)
	}

	if err := ctx.Err(); err != nil {
		cancel(PipelinePulling, err.Error())
		return fmt.Errorf("deploy cancelled before pulling %s: %w", targetCommit, err)
	}

	stageStart(PipelinePulling)
	if err := d.repo.Pull(ctx, d.branch); err != nil {
		fail(PipelinePulling, err.Error())
		return fmt.Errorf("pulling %s: %w", targetCommit, err)
	}
	stageFinish(PipelinePulling)

	if err := ctx.Err(); err != nil {
		cancel(PipelineBuilding, err.Error())
		return fmt.Errorf("deploy cancelled before building %s: %w", targetCommit, err)
	}

	update(PipelineBuilding, "")
	stageStart(PipelineBuilding)

	// activeStage tracks Building vs. Deploying as deploy.sh's own markers
	// move it along, so a deploy.Run failure (result.Success == false
	// below) knows which of the two was actually running when the script
	// exited non-zero — deploy.Run itself only reports pass/fail for the
	// whole script, not which stage it died in.
	activeStage := PipelineBuilding
	result := deploy.Run(ctx, d.cfg.RepoPath, d.cfg.DeployScriptPath(), d.cfg.DeployTimeout(), func(ev deploy.StageEvent) {
		switch ev.Stage {
		case deploy.StageBuilding:
			// Already in Building (set above, before deploy.Run started) —
			// deploy.sh's own building marker re-confirms the same
			// transition, so nothing further to do here.
		case deploy.StageDeploying:
			stageFinish(PipelineBuilding)
			update(PipelineDeploying, "")
			stageStart(PipelineDeploying)
			activeStage = PipelineDeploying
		case deploy.StageHealthy:
			// Deploying's own finish is recorded once deploy.Run returns
			// (below) — healthy is a marker within the deploying stage
			// (migration ran, api container reachable), not a distinct
			// pipeline stage of its own.
		}
	})
	if result.Success {
		stageFinish(PipelineDeploying)
	}

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
	d.lastResultSnap = result
	d.mu.Unlock()

	if result.Success {
		update(PipelineSuccess, "")
		return nil
	}

	errMsg := result.Output
	const maxErrorLen = 1500
	if len(errMsg) > maxErrorLen {
		errMsg = errMsg[len(errMsg)-maxErrorLen:]
	}
	fail(activeStage, errMsg)
	return fmt.Errorf("deploy.sh failed after %s", result.Duration.Round(time.Second))
}

func (d *Deployer) lastResult() deploy.Result {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.lastResultSnap
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
