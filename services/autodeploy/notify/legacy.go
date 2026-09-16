package notify

import (
	"context"
	"fmt"

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

func (l *LegacyNotifier) PostReport(ctx context.Context, report deployer.Report) error {
	durationStr := report.Duration.Round(0).String()
	if report.Success {
		return l.discord.DeploySucceeded(report.CommitHash, durationStr)
	}
	return l.discord.DeployFailed(report.CommitHash, durationStr, report.Output)
}

func (l *LegacyNotifier) PostPollError(ctx context.Context, err error) error {
	return l.discord.PollError(err)
}
