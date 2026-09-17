package notify

import (
	"context"
	"fmt"
	"time"

	"playanime/autodeploy/deployer"
	"playanime/autodeploy/git"
)

// LegacyNotifier adapts the plain webhook Discord type to satisfy
// deployer.Notifier, for the fallback "no bot configured" mode where
// every new commit deploys immediately with no approval gate.
// PostOrUpdateApproval/ResolveApproval are never actually called in that
// mode (deployer.Poll takes the direct-deploy branch when its notifier has
// no approval capability to use — see deployer.go), so they exist here
// only to satisfy the interface, not because webhook mode has an approval
// flow.
//
// The live-ticking pipeline message (SendPipelineMessage/
// UpdatePipelineMessage/Start|StopPipelineTick) is a bot-mode-only feature:
// a plain incoming webhook has no message-edit API to speak of (Discord.post
// always creates a new message, with no id tracked back), so there is
// nothing to tick — this type intentionally reports once, at the end,
// exactly like it always has, rather than half-implementing live updates it
// cannot actually deliver.
type LegacyNotifier struct {
	discord *Discord
}

func NewLegacyNotifier(discord *Discord) *LegacyNotifier {
	return &LegacyNotifier{discord: discord}
}

func (l *LegacyNotifier) PostOrUpdateApproval(ctx context.Context, messageID string, commits []git.Commit, targetCommit string) (string, error) {
	return "", fmt.Errorf("approval workflow is not available in webhook-only mode (no discord.botToken configured)")
}

func (l *LegacyNotifier) ResolveApproval(ctx context.Context, messageID string, approved bool) error {
	return fmt.Errorf("approval workflow is not available in webhook-only mode (no discord.botToken configured)")
}

func (l *LegacyNotifier) PostPollError(ctx context.Context, err error) error {
	return l.discord.PollError(err)
}

// SendPipelineMessage is a no-op that reports success with no message IDs —
// deployTo treats an empty MessageIDs map as "nothing to update," so every
// later UpdatePipelineMessage/tick call for this run correctly does
// nothing, and the actual report is sent once, at the very end, from
// UpdatePipelineMessage's own terminal-stage check below.
func (l *LegacyNotifier) SendPipelineMessage(ctx context.Context, s deployer.PipelineState) (map[string]string, error) {
	return nil, nil
}

// UpdatePipelineMessage only actually posts anything on a terminal stage
// (Success/Failed/Cancelled) — every non-terminal call here is from a real
// mid-deploy transition deployTo made, which webhook-only mode has no way
// to show live, so it's silently skipped rather than spamming a new
// webhook message per stage.
func (l *LegacyNotifier) UpdatePipelineMessage(ctx context.Context, s deployer.PipelineState) error {
	switch s.Stage {
	case deployer.PipelineSuccess:
		return l.discord.DeploySucceeded(s.CommitHash, totalDuration(s).Round(0).String())
	case deployer.PipelineFailed:
		return l.discord.DeployFailed(s.CommitHash, totalDuration(s).Round(0).String(), s.Error)
	case deployer.PipelineCancelled:
		// Discord (discord.go) has no dedicated "cancelled" webhook shape —
		// reusing DeployFailed's format with an explicit prefix so it's
		// never mistaken for an actual break, without adding a third
		// near-identical webhook method for an outcome no real caller
		// triggers yet (see PipelineCancelled's own doc comment in
		// deployer.go).
		return l.discord.DeployFailed(s.CommitHash, totalDuration(s).Round(0).String(), "Cancelled: "+s.Error)
	default:
		return nil
	}
}

func (l *LegacyNotifier) StartPipelineTick(s deployer.PipelineState) {}
func (l *LegacyNotifier) StopPipelineTick(s deployer.PipelineState)  {}

func totalDuration(s deployer.PipelineState) time.Duration {
	if s.StartedAt.IsZero() {
		return 0
	}
	return time.Since(s.StartedAt)
}
