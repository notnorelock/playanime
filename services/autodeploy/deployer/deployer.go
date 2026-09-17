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
	"strings"
	"sync"
	"time"

	"playanime/autodeploy/config"
	"playanime/autodeploy/deploy"
	"playanime/autodeploy/git"
	"playanime/autodeploy/redisstate"
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

// redisRecordTTL is comfortably above config.Config's own default
// DeployTimeout (10 minutes) — the TTL is only a safety net for a crashed
// process that never reached Clear, not the primary correctness
// mechanism (that's Reattach actually checking, via deploy.IsRunning,
// whether the recorded container is still running before trusting a
// stale-looking record).
const redisRecordTTL = 20 * time.Minute

type Deployer struct {
	repo     *git.Repo
	branch   string
	cfg      *config.Config
	store    *state.Store
	notifier Notifier // nil in webhook-only fallback mode — see main.go
	// redis is nil whenever config.Config.RedisURL is unset — deploy-in-
	// -progress reattachment is an additive safety net (see
	// config.Config.RedisURL's own doc comment), not a hard requirement;
	// every redis-touching call in this file is a no-op when this is nil.
	redis *redisstate.Client

	mu                sync.Mutex
	inProgress        bool
	lastPollErrorMsg  string
	lastResultSnap    deploy.Result
	// activeContainerID is the detached deploy container currently being
	// driven by deployTo or Reattach, if any — read by syncRedisRecord to
	// know which container a redisstate.DeployRecord should point at. Set
	// by deployTo right after deploy.StartDetached returns, and by
	// Reattach for the container it resumed; cleared when that run ends.
	activeContainerID string
}

func New(repo *git.Repo, branch string, cfg *config.Config, store *state.Store, notifier Notifier, redis *redisstate.Client) *Deployer {
	return &Deployer{repo: repo, branch: branch, cfg: cfg, store: store, notifier: notifier, redis: redis}
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
//
// If targetCommit is already the last SUCCESSFULLY deployed commit, this
// resolves the approval without calling deployTo at all — a real scenario,
// not just theoretical: `deploy.sh` can be run by hand directly on the
// VPS (bypassing the bot entirely), which advances what's actually
// running but NOT autodeploy's own AcknowledgedCommit bookkeeping (only
// Approve/Skip/a direct deployTo call do that) — so the next poll still
// sees that same commit as pending and posts an approval request for
// something that's already live. Clicking Approve on it used to always
// attempt a genuinely redundant rebuild, and if that raced an unrelated
// deploy already in progress, deployTo's own concurrency guard would
// return an error — which, being non-nil, meant ResolveApproval was
// never reached at all, leaving the message stuck showing live buttons
// with no visible outcome. Short-circuiting here avoids both the
// redundant rebuild and that race in the one case where deploying again
// achieves nothing anyway.
func (d *Deployer) Approve(ctx context.Context, targetCommit string) error {
	s := d.store.Get()
	messageID := s.PendingMessageID

	if s.LastDeploySucceeded && s.LastDeployedCommit == targetCommit {
		if err := d.store.Update(func(st *state.State) {
			st.AcknowledgedCommit = targetCommit
			st.PendingCommit = ""
			st.PendingMessageID = ""
			st.PendingChannelID = ""
		}); err != nil {
			log.Printf("persisting already-deployed acknowledgement: %v", err)
		}
	} else if err := d.deployTo(ctx, targetCommit); err != nil {
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
		d.setCurrentContainerID("")
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
		d.syncRedisRecord(ctx, pipeline)
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

	containerID, err := deploy.StartDetached(ctx, d.cfg.RepoPath, d.cfg.DeployScriptPath(), d.cfg.SelfImage, targetCommit)
	if err != nil {
		fail(PipelineBuilding, err.Error())
		return fmt.Errorf("starting detached deploy container for %s: %w", targetCommit, err)
	}
	d.setCurrentContainerID(containerID)

	update(PipelineBuilding, "")
	stageStart(PipelineBuilding)

	result := d.runDetached(ctx, containerID, &pipeline, stageStart, stageFinish, update)

	return d.finalize(ctx, targetCommit, &pipeline, result, update, fail)
}

// runDetached streams and waits on an already-started (or already-running,
// for a reattach — see Reattach) detached deploy container to completion,
// advancing pipeline through Building -> Deploying via deploy.sh's own
// stage markers exactly like the old in-process deploy.Run did — the only
// difference from before is that the work now happens in a container that
// survives autodeploy's own container being replaced, not that the
// observed stage transitions differ at all.
//
// Shared by deployTo (called right after StartDetached, from Building) and
// Reattach (called against a container discovered via redisstate, from
// whatever stage it was already at) so there is exactly one place that
// knows how to drive a detached run to a deploy.Result — not two
// implementations that could drift apart.
func (d *Deployer) runDetached(
	ctx context.Context,
	containerID string,
	pipeline *PipelineState,
	stageStart, stageFinish func(PipelineStage),
	update func(PipelineStage, string),
) deploy.Result {
	started := time.Now()

	// activeStage tracks Building vs. Deploying as deploy.sh's own markers
	// move it along, so a failure (below) knows which of the two was
	// actually running when the script exited non-zero — Wait itself only
	// reports the container's exit code, not which stage it died in.
	activeStage := pipeline.Stage
	if activeStage != PipelineDeploying {
		activeStage = PipelineBuilding
	}

	output := &strings.Builder{}
	var outputMu sync.Mutex
	writeLine := func(line string) {
		outputMu.Lock()
		defer outputMu.Unlock()
		output.WriteString(line)
		output.WriteByte('\n')
	}

	// StreamLogs blocks until the container stops producing output
	// (normally because it exited); Wait blocks until the exit code is
	// actually available. Both operate on the same already-running
	// container independently — running them concurrently means the
	// pipeline embed keeps advancing on real stage markers as they're
	// printed, rather than only learning about them after the whole run
	// finishes.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = deploy.StreamLogs(ctx, containerID, func(ev deploy.StageEvent) {
			switch ev.Stage {
			case deploy.StageBuilding:
				// Already in Building — deploy.sh's own building marker
				// re-confirms the same transition, nothing further to do.
			case deploy.StageDeploying:
				stageFinish(PipelineBuilding)
				update(PipelineDeploying, "")
				stageStart(PipelineDeploying)
				activeStage = PipelineDeploying
			case deploy.StageHealthy:
				// Deploying's own finish is recorded once Wait returns
				// below — healthy is a marker within the deploying stage
				// (migration ran, api container reachable), not a distinct
				// pipeline stage of its own.
			}
		}, writeLine)
	}()

	exitCode, waitErr := deploy.Wait(ctx, containerID)
	wg.Wait() // StreamLogs should already be done once the container exits, but wait explicitly rather than assume the ordering

	if cleanupErr := deploy.Cleanup(context.Background(), containerID); cleanupErr != nil {
		// Not fatal to reporting the deploy's own result — a leftover
		// exited container is a cosmetic cleanup miss, not a correctness
		// problem; logged so it isn't silently invisible either.
		log.Printf("cleaning up detached deploy container %s: %v", containerID, cleanupErr)
	}

	success := waitErr == nil && exitCode == 0
	if success {
		stageFinish(PipelineDeploying)
	}

	outputMu.Lock()
	outStr := output.String()
	outputMu.Unlock()

	if waitErr != nil {
		outStr += fmt.Sprintf("\n\n[autodeploy] waiting on container: %v", waitErr)
	}

	pipeline.FailedStage = activeStage // only actually used by finalize when !success; harmless to set unconditionally

	return deploy.Result{
		Success:  success,
		Output:   outStr,
		Duration: time.Since(started),
	}
}

// finalize persists result to state.Store (mirrors the pre-detached-
// -container version's own final block) and reports the terminal pipeline
// stage — shared by deployTo and Reattach so both end a run the same way.
func (d *Deployer) finalize(
	ctx context.Context,
	targetCommit string,
	pipeline *PipelineState,
	result deploy.Result,
	update func(PipelineStage, string),
	fail func(PipelineStage, string),
) error {
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

	d.clearRedisRecord(ctx)

	if result.Success {
		update(PipelineSuccess, "")
		return nil
	}

	errMsg := result.Output
	const maxErrorLen = 1500
	if len(errMsg) > maxErrorLen {
		errMsg = errMsg[len(errMsg)-maxErrorLen:]
	}
	fail(pipeline.FailedStage, errMsg)
	return fmt.Errorf("deploy.sh failed after %s", result.Duration.Round(time.Second))
}

// syncRedisRecord writes (or overwrites) the redisstate record describing
// pipeline's current progress — called from the update() closure at every
// real stage transition, so the record a replacement autodeploy process
// would find via Reattach is never more than one transition stale. A nil
// d.redis (RedisURL unset) or an empty pipeline.MessageIDs (nothing was
// ever successfully posted to Discord for this run — see deployTo's own
// comment on why that's tolerated, not fatal) makes this a no-op: there's
// nothing useful to reattach to either way.
func (d *Deployer) syncRedisRecord(ctx context.Context, pipeline PipelineState) {
	if d.redis == nil || len(pipeline.MessageIDs) == 0 {
		return
	}

	// containerID isn't part of PipelineState itself (it's an
	// implementation detail of how the stage runs, not something a
	// Notifier renders) — syncRedisRecord is only ever called from within
	// deployTo/Reattach's own closures, which is exactly where the field
	// below is threaded through; see callers.
	rec := redisstate.DeployRecord{
		ContainerID:   d.currentContainerID(),
		TargetCommit:  pipeline.CommitHash,
		StartedAt:     pipeline.StartedAt,
		Stage:         string(pipeline.Stage),
		CommitSubject: pipeline.CommitSubject,
		Author:        pipeline.Author,
		Branch:        pipeline.Branch,
		Commits:       pipeline.Commits,
		FileChanges:   pipeline.FileChanges,
		MessageIDs:    pipeline.MessageIDs,
	}
	if rec.ContainerID == "" {
		return
	}
	if err := d.redis.Set(ctx, rec, redisRecordTTL); err != nil {
		log.Printf("writing deploy record to redis: %v", err)
	}
}

// clearRedisRecord removes the active-deploy record once a run reaches
// any terminal state — called from finalize, which runs for both a fresh
// deployTo run and a Reattach-driven one.
func (d *Deployer) clearRedisRecord(ctx context.Context) {
	if d.redis == nil {
		return
	}
	if err := d.redis.Clear(ctx); err != nil {
		log.Printf("clearing deploy record from redis: %v", err)
	}
}

// currentContainerID returns the detached container ID syncRedisRecord
// should associate with the in-progress run, if any is set — see
// setCurrentContainerID.
func (d *Deployer) currentContainerID() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.activeContainerID
}

func (d *Deployer) setCurrentContainerID(id string) {
	d.mu.Lock()
	d.activeContainerID = id
	d.mu.Unlock()
}

// Reattach looks for a redisstate record left behind by a run that was
// still in progress when this process started — meaning a previous
// autodeploy process (almost always this same container, recreated mid-
// -deploy by its own self-redeploy; see README.md's former "Known quirk"
// section) launched a detached deploy container and never got to see it
// finish. Called once from main.go before the poll loop starts.
//
// Three outcomes:
//  1. No record — the common case, nothing to do.
//  2. A record whose container is still running (deploy.IsRunning) — pick
//     the run back up: rebuild a PipelineState from the record (best
//     effort; per-stage timings before this point aren't recoverable, but
//     Stage/MessageIDs/commit info are, which is enough to keep editing
//     the SAME live Discord embed rather than orphaning it — see
//     PipelineState.MessageIDs's own doc comment), then drive it to
//     completion via the same runDetached/finalize path deployTo uses.
//  3. A record whose container is no longer running — it genuinely died
//     (the deploy container was itself killed, the host rebooted, ...).
//     Rather than pretend otherwise, this is reported as a real failure
//     and the stale record is cleared; the next poll will find the target
//     commit still unacknowledged and start a fresh deploy.
func (d *Deployer) Reattach(ctx context.Context) error {
	if d.redis == nil {
		return nil
	}

	rec, found, err := d.redis.Get(ctx)
	if err != nil {
		return fmt.Errorf("reading redis deploy record: %w", err)
	}
	if !found {
		return nil
	}

	running, err := deploy.IsRunning(ctx, rec.ContainerID)
	if err != nil {
		return fmt.Errorf("checking detached container %s: %w", rec.ContainerID, err)
	}

	if !running {
		log.Printf("reattach: recorded deploy container %s (commit %s) is no longer running — treating as failed and clearing stale record", rec.ContainerID, rec.TargetCommit)
		d.clearRedisRecord(ctx)
		if d.notifier != nil && len(rec.MessageIDs) > 0 {
			stale := PipelineState{
				CommitHash:    rec.TargetCommit,
				CommitSubject: rec.CommitSubject,
				Author:        rec.Author,
				Branch:        rec.Branch,
				StartedAt:     rec.StartedAt,
				Stage:         PipelineFailed,
				FailedStage:   PipelineStage(rec.Stage),
				Error:         "autodeploy restarted and the in-progress deploy container was no longer running — it did not survive, and will be retried on the next poll",
				MessageIDs:    rec.MessageIDs,
				Timings:       map[PipelineStage]*StageTiming{},
			}
			if err := d.notifier.UpdatePipelineMessage(ctx, stale); err != nil {
				log.Printf("reporting lost deploy to discord: %v", err)
			}
		}
		return nil
	}

	log.Printf("reattach: found still-running deploy container %s (commit %s) — resuming", rec.ContainerID, rec.TargetCommit)

	d.mu.Lock()
	d.inProgress = true
	d.mu.Unlock()
	d.setCurrentContainerID(rec.ContainerID)
	defer func() {
		d.mu.Lock()
		d.inProgress = false
		d.mu.Unlock()
		d.setCurrentContainerID("")
	}()

	pipeline := PipelineState{
		CommitHash:    rec.TargetCommit,
		CommitSubject: rec.CommitSubject,
		Author:        rec.Author,
		Branch:        rec.Branch,
		StartedAt:     rec.StartedAt,
		Stage:         PipelineStage(rec.Stage),
		Timings:       map[PipelineStage]*StageTiming{},
		Commits:       rec.Commits,
		FileChanges:   rec.FileChanges,
		MessageIDs:    rec.MessageIDs,
	}

	// Pulling/Building's real per-stage start/finish moments lived only in
	// the PREVIOUS process's memory (never persisted — only the run's
	// overall StartedAt and current Stage are) — by the time this process
	// reattaches to an already-running detached container, both stages are
	// necessarily already finished (deploy.sh only becomes visible in
	// Docker once it exists, i.e. mid-Building at the earliest). Rather
	// than leave Timings empty (which rendered these as if they'd never
	// run at all — the bug this fix addresses), seed both with the same
	// StartedAt->now span: not the real per-stage split, but a real,
	// defensible "how long this deploy has been running so far" number
	// instead of either a fabricated split or nothing.
	now := time.Now()
	pipeline.Timings[PipelinePulling] = &StageTiming{StartedAt: rec.StartedAt, FinishedAt: now}
	pipeline.Timings[PipelineBuilding] = &StageTiming{StartedAt: rec.StartedAt, FinishedAt: now}

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
		d.syncRedisRecord(ctx, pipeline)
	}
	fail := func(stage PipelineStage, errMsg string) {
		pipeline.FailedStage = stage
		update(PipelineFailed, errMsg)
	}
	stageStart := func(stage PipelineStage) {
		pipeline.Timings[stage] = &StageTiming{StartedAt: time.Now()}
	}
	stageFinish := func(stage PipelineStage) {
		if t, ok := pipeline.Timings[stage]; ok {
			t.FinishedAt = time.Now()
		}
	}

	if d.notifier != nil && len(pipeline.MessageIDs) > 0 {
		d.notifier.StartPipelineTick(pipeline)
		defer d.notifier.StopPipelineTick(pipeline)
	}

	result := d.runDetached(ctx, rec.ContainerID, &pipeline, stageStart, stageFinish, update)

	return d.finalize(ctx, rec.TargetCommit, &pipeline, result, update, fail)
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
