package notify

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"

	"playanime/autodeploy/deployer"
	"playanime/autodeploy/git"
)

const (
	approveButtonID = "autodeploy_approve"
	skipButtonID    = "autodeploy_skip"
)

// Bot is a Discord bot implementing deployer.Notifier: the approval
// workflow's private-channel pending message with Approve/Skip buttons,
// the two-channel build report, and the /deploy + /status slash commands.
type Bot struct {
	session          *discordgo.Session
	guildID          string
	allowedRoleIDs   []string
	publicChannelID  string
	privateChannelID string
	deployer         *deployer.Deployer

	registeredCommandIDs []string
}

// NewBot creates the bot's Discord session but does not wire in a
// deployer yet — see SetDeployer. Split this way because construction is
// circular: deployer.New wants a Notifier (which *Bot satisfies), and the
// bot's command/button handlers want a *deployer.Deployer to call into.
// main.go breaks the cycle by creating the bot first, then the deployer
// (passing the bot in as its Notifier), then calling SetDeployer.
//
// allowedRoleIDs is one or more Discord role IDs — a member needs only one
// of them, not all, to use /deploy or the Approve/Skip buttons.
func NewBot(token, guildID string, allowedRoleIDs []string, publicChannelID, privateChannelID string) (*Bot, error) {
	session, err := discordgo.New("Bot " + token)
	if err != nil {
		return nil, fmt.Errorf("creating discord session: %w", err)
	}

	bot := &Bot{
		session:          session,
		guildID:          guildID,
		allowedRoleIDs:   allowedRoleIDs,
		publicChannelID:  publicChannelID,
		privateChannelID: privateChannelID,
	}

	session.AddHandler(bot.handleInteraction)

	return bot, nil
}

// SetDeployer wires in the deployer the bot's commands/buttons call into.
// Must be called before Start (session.Open — interaction handlers only
// fire after that, so this has no race to worry about as long as it runs
// first).
func (b *Bot) SetDeployer(d *deployer.Deployer) {
	b.deployer = d
}

// Start opens the gateway connection and registers /deploy and /status as
// guild commands (instant availability — global commands can take up to
// an hour to propagate).
func (b *Bot) Start() error {
	if err := b.session.Open(); err != nil {
		return fmt.Errorf("opening discord session: %w", err)
	}

	commands := []*discordgo.ApplicationCommand{
		{
			Name:        "deploy",
			Description: "Pull the latest commit and deploy now, without waiting for approval",
		},
		{
			Name:        "status",
			Description: "Show the currently deployed commit and last deploy result",
		},
	}

	for _, cmd := range commands {
		created, err := b.session.ApplicationCommandCreate(b.session.State.User.ID, b.guildID, cmd)
		if err != nil {
			return fmt.Errorf("registering /%s command: %w", cmd.Name, err)
		}
		b.registeredCommandIDs = append(b.registeredCommandIDs, created.ID)
	}

	log.Printf("discord bot connected and commands registered in guild %s", b.guildID)
	return nil
}

// Stop removes the registered commands and closes the connection — mainly
// so re-running autodeploy during development doesn't accumulate duplicate
// command registrations; ApplicationCommandCreate is idempotent (updates
// an existing command with the same name) so this isn't strictly required
// for correctness, only tidiness.
func (b *Bot) Stop() {
	for _, id := range b.registeredCommandIDs {
		if err := b.session.ApplicationCommandDelete(b.session.State.User.ID, b.guildID, id); err != nil {
			log.Printf("removing command %s: %v", id, err)
		}
	}
	if err := b.session.Close(); err != nil {
		log.Printf("closing discord session: %v", err)
	}
}

func (b *Bot) handleInteraction(s *discordgo.Session, i *discordgo.InteractionCreate) {
	switch i.Type {
	case discordgo.InteractionApplicationCommand:
		switch i.ApplicationCommandData().Name {
		case "deploy":
			b.handleDeployCommand(i)
		case "status":
			b.handleStatusCommand(i)
		}
	case discordgo.InteractionMessageComponent:
		b.handleButton(i)
	}
}

// hasAllowedRole checks the invoking member's roles against
// allowedRoleIDs — true if the member holds any one of them, not all.
// Interaction.Member is only populated for a guild interaction (not a
// DM), which is already guaranteed here since commands and buttons are
// only ever posted/registered guild-scoped.
func (b *Bot) hasAllowedRole(i *discordgo.InteractionCreate) bool {
	if i.Member == nil {
		return false
	}
	for _, roleID := range i.Member.Roles {
		for _, allowed := range b.allowedRoleIDs {
			if roleID == allowed {
				return true
			}
		}
	}
	return false
}

func (b *Bot) handleDeployCommand(i *discordgo.InteractionCreate) {
	if !b.hasAllowedRole(i) {
		b.respondEphemeral(i, "You don't have permission to run this command.")
		return
	}

	// Slash command interactions must be acknowledged within 3 seconds —
	// a deploy takes far longer, so defer immediately and edit the
	// deferred response once the deploy actually finishes.
	if err := b.session.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{Flags: discordgo.MessageFlagsEphemeral},
	}); err != nil {
		log.Printf("deferring /deploy response: %v", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	deployed, result, err := b.deployer.DeployNow(ctx)

	var content string
	switch {
	case err != nil && strings.Contains(err.Error(), "already in progress"):
		content = "A deploy is already in progress — try `/status` in a moment."
	case err != nil:
		content = fmt.Sprintf("⚠️ %v", err)
	case !deployed:
		content = "Already up to date, nothing to deploy."
	case result.Success:
		content = fmt.Sprintf("✅ Deployed in %s — see the report in <#%s>.", result.Duration.Round(time.Second), b.publicChannelID)
	default:
		content = fmt.Sprintf("❌ Deploy failed after %s — see <#%s> for details.", result.Duration.Round(time.Second), b.privateChannelID)
	}

	if _, err := b.session.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{Content: &content}); err != nil {
		log.Printf("editing /deploy response: %v", err)
	}
}

func (b *Bot) handleStatusCommand(i *discordgo.InteractionCreate) {
	status := b.deployer.StatusSnapshot()

	var content string
	switch {
	case status.InProgress:
		content = "A deploy is currently in progress."
	case status.PendingCommit != "":
		content = fmt.Sprintf("Commit `%s` is awaiting approval in <#%s>.", shortHash(status.PendingCommit), b.privateChannelID)
	case status.LastDeployedCommit == "":
		content = "No deploy has run since autodeploy started."
	default:
		result := "✅ succeeded"
		if !status.LastDeploySucceeded {
			result = "❌ failed"
		}
		content = fmt.Sprintf(
			"Last deployed commit: `%s`\nDeployed: %s\nResult: %s",
			shortHash(status.LastDeployedCommit),
			formatTime(status.LastDeployedAt),
			result,
		)
	}

	b.respondEphemeral(i, content)
}

func (b *Bot) handleButton(i *discordgo.InteractionCreate) {
	if !b.hasAllowedRole(i) {
		b.respondEphemeral(i, "You don't have permission to do this.")
		return
	}

	customID := i.MessageComponentData().CustomID
	targetCommit := strings.TrimPrefix(strings.TrimPrefix(customID, approveButtonID+":"), skipButtonID+":")
	approve := strings.HasPrefix(customID, approveButtonID+":")

	if err := b.session.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredMessageUpdate,
	}); err != nil {
		log.Printf("deferring button response: %v", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	var err error
	if approve {
		err = b.deployer.Approve(ctx, targetCommit)
	} else {
		err = b.deployer.Skip(ctx, targetCommit)
	}
	if err != nil {
		log.Printf("handling button (%s): %v", customID, err)
		// ResolveApproval below already ran as part of Approve/Skip on the
		// happy path; on an error the message is left as-is (still showing
		// buttons) rather than guessing at a partial edit — the next poll
		// or a retry click is the recovery path, not this handler.
	}
}

func (b *Bot) respondEphemeral(i *discordgo.InteractionCreate, content string) {
	err := b.session.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: content,
			Flags:   discordgo.MessageFlagsEphemeral,
		},
	})
	if err != nil {
		log.Printf("responding to interaction: %v", err)
	}
}

// --- deployer.Notifier implementation ---------------------------------

func (b *Bot) PostOrUpdateApproval(ctx context.Context, messageID string, commits []git.Commit, targetCommit string) (string, error) {
	embed := &discordgo.MessageEmbed{
		Title:       fmt.Sprintf("⏳ %d commit(s) awaiting approval", len(commits)),
		Description: changelogText(commits),
		Color:       colorYellow,
		Fields: []*discordgo.MessageEmbedField{
			{Name: "Target commit", Value: fmt.Sprintf("`%s`", shortHash(targetCommit)), Inline: true},
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	components := []discordgo.MessageComponent{
		discordgo.ActionsRow{Components: []discordgo.MessageComponent{
			discordgo.Button{Label: "Approve", Style: discordgo.SuccessButton, CustomID: approveButtonID + ":" + targetCommit},
			discordgo.Button{Label: "Skip", Style: discordgo.SecondaryButton, CustomID: skipButtonID + ":" + targetCommit},
		}},
	}

	content := fmt.Sprintf("%s a new commit needs review.", mentionRoles(b.allowedRoleIDs))

	if messageID == "" {
		msg, err := b.session.ChannelMessageSendComplex(b.privateChannelID, &discordgo.MessageSend{
			Content:    content,
			Embeds:     []*discordgo.MessageEmbed{embed},
			Components: components,
		})
		if err != nil {
			return "", fmt.Errorf("sending approval message: %w", err)
		}
		return msg.ID, nil
	}

	_, err := b.session.ChannelMessageEditComplex(&discordgo.MessageEdit{
		Channel:    b.privateChannelID,
		ID:         messageID,
		Content:    &content,
		Embeds:     &[]*discordgo.MessageEmbed{embed},
		Components: &components,
	})
	if err != nil {
		return "", fmt.Errorf("updating approval message: %w", err)
	}
	return messageID, nil
}

func (b *Bot) ResolveApproval(ctx context.Context, messageID string, approved bool) error {
	status := "⏭️ Skipped — will not be deployed."
	if approved {
		status = "▶️ Approved — deploying now, see the report below shortly."
	}

	noComponents := []discordgo.MessageComponent{}
	_, err := b.session.ChannelMessageEditComplex(&discordgo.MessageEdit{
		Channel:    b.privateChannelID,
		ID:         messageID,
		Content:    &status,
		Components: &noComponents,
	})
	return err
}

func (b *Bot) PostReport(ctx context.Context, report deployer.Report) error {
	title := fmt.Sprintf("✅ deploy `%s` — success", shortHash(report.CommitHash))
	color := colorGreen
	if !report.Success {
		title = fmt.Sprintf("❌ deploy `%s` — failed", shortHash(report.CommitHash))
		color = colorRed
	}

	publicEmbed := &discordgo.MessageEmbed{
		Title:       title,
		Description: report.CommitSubject,
		Color:       color,
		Fields: []*discordgo.MessageEmbedField{
			{Name: "Author", Value: report.Author, Inline: true},
			{Name: "Duration", Value: report.Duration.Round(time.Second).String(), Inline: true},
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if _, err := b.session.ChannelMessageSendEmbed(b.publicChannelID, publicEmbed); err != nil {
		log.Printf("posting public report: %v", err)
	}

	privateEmbed := &discordgo.MessageEmbed{
		Title:       title,
		Description: report.CommitSubject,
		Color:       color,
		Fields: []*discordgo.MessageEmbedField{
			{Name: "Author", Value: report.Author, Inline: true},
			{Name: "Duration", Value: report.Duration.Round(time.Second).String(), Inline: true},
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	if !report.Success {
		privateEmbed.Fields = append(privateEmbed.Fields, &discordgo.MessageEmbedField{
			Name:  "Output (tail)",
			Value: "```\n" + truncateTail(report.Output, maxFieldLength-8) + "\n```",
		})
	}

	if _, err := b.session.ChannelMessageSendEmbed(b.privateChannelID, privateEmbed); err != nil {
		return fmt.Errorf("posting private report: %w", err)
	}
	return nil
}

func (b *Bot) PostPollError(ctx context.Context, err error) error {
	embed := &discordgo.MessageEmbed{
		Title:       "⚠️ autodeploy couldn't check for updates",
		Description: "```\n" + truncateTail(err.Error(), maxFieldLength) + "\n```",
		Color:       colorRed,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
	_, sendErr := b.session.ChannelMessageSendEmbed(b.privateChannelID, embed)
	return sendErr
}

func changelogText(commits []git.Commit) string {
	if len(commits) == 0 {
		return "_(no commit details available)_"
	}
	var b strings.Builder
	for _, c := range commits {
		fmt.Fprintf(&b, "`%s` %s — %s\n", c.ShortHash, c.Subject, c.Author)
	}
	text := b.String()
	// Discord embed descriptions cap at 4096 characters.
	const maxDescriptionLength = 4000
	if len(text) > maxDescriptionLength {
		text = text[:maxDescriptionLength] + "\n...(truncated)"
	}
	return text
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return "never"
	}
	return fmt.Sprintf("<t:%d:R>", t.Unix()) // Discord's own relative-time formatting, e.g. "3 minutes ago"
}

// mentionRoles builds a single message pinging every given role — Discord
// renders each "<@&roleID>" as a clickable, notifying mention as long as
// the bot has the "Mention @everyone, @here, and All Roles" permission
// (see DiscordBotConfig.BotToken's doc comment).
func mentionRoles(roleIDs []string) string {
	mentions := make([]string, len(roleIDs))
	for i, id := range roleIDs {
		mentions[i] = fmt.Sprintf("<@&%s>", id)
	}
	return strings.Join(mentions, " ")
}
