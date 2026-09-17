package notify

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/bwmarrin/discordgo"

	"playanime/autodeploy/deployer"
	"playanime/autodeploy/git"
)

const (
	approveButtonID = "autodeploy_approve"
	skipButtonID    = "autodeploy_skip"

	// pipelineTickInterval matches the reference implementation's own 30s
	// cadence — frequent enough that elapsed time visibly moves, well
	// inside Discord's real per-channel message-edit rate limit even with
	// both configured channels ticking independently (see buildPipelineEmbed
	// and the edit-queue below for why a burst of real transitions can
	// never itself trigger a 429 loop).
	pipelineTickInterval = 30 * time.Second
)

// Bot is a Discord bot implementing deployer.Notifier: the approval
// workflow's private-channel pending message with Approve/Skip buttons,
// the live per-stage pipeline message (public + private channels), and the
// /deploy + /status slash commands.
type Bot struct {
	session          *discordgo.Session
	guildID          string
	allowedRoleIDs   []string
	publicChannelID  string
	privateChannelID string
	deployer         *deployer.Deployer

	registeredCommandIDs []string

	// stageEmojiNames is the raw config (stage -> custom emoji NAME);
	// stageEmojis is resolved against the guild's real emoji list once in
	// Start() (needs an open session) — see notify/emoji.go. Read-only
	// after Start returns, so no lock needed on either.
	stageEmojiNames map[string]string
	stageEmojis     map[string]string

	// editQueues/editBusy/tickTimers back the pipeline message's live
	// updates — see enqueuePipelineEdit's own doc comment for the
	// serialization contract this implements (ported from the reference
	// project's discord.ts, which solved the same "never let a stale tick
	// overwrite a newer real state" problem this needs).
	editMu     sync.Mutex
	editQueues map[string][]pipelineEdit // key: "channelID:messageID"
	editBusy   map[string]bool
	tickMu     sync.Mutex
	tickTimers map[string]*time.Ticker // key: same MessageIDs-derived tick key as pipelineTickKey
	tickStop   map[string]chan struct{}
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
//
// stageEmojiNames is config.DiscordBotConfig.StageEmojis verbatim (stage
// name -> custom guild emoji name) — resolved against the guild's real
// emoji list once Start() opens the session (listing guild emojis needs an
// authenticated connection); nil/empty is fine and just means every stage
// falls back to a plain Unicode emoji.
func NewBot(token, guildID string, allowedRoleIDs []string, publicChannelID, privateChannelID string, stageEmojiNames map[string]string) (*Bot, error) {
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
		stageEmojiNames:  stageEmojiNames,
		editQueues:       make(map[string][]pipelineEdit),
		editBusy:         make(map[string]bool),
		tickTimers:       make(map[string]*time.Ticker),
		tickStop:         make(map[string]chan struct{}),
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

// Start opens the gateway connection, resolves stageEmojiNames against the
// guild's real custom emojis (once, cached for the process lifetime — see
// notify/emoji.go), and registers /deploy and /status as guild commands
// (instant availability — global commands can take up to an hour to
// propagate).
func (b *Bot) Start() error {
	if err := b.session.Open(); err != nil {
		return fmt.Errorf("opening discord session: %w", err)
	}

	if resolved, err := loadStageEmojis(b.session, b.guildID, b.stageEmojiNames); err != nil {
		// Not fatal — every stage simply falls back to a plain Unicode
		// emoji (see buildPipelineEmbed) rather than blocking startup over
		// what is purely a cosmetic enhancement.
		log.Printf("resolving custom stage emojis (falling back to defaults): %v", err)
	} else {
		b.stageEmojis = resolved
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

// --- Live pipeline message ---------------------------------------------

const colorBlue = 0x5865f2 // in-progress stages — Discord's own blurple

// pipelineChannels is every channel the live pipeline message goes to.
// Both, matching PostReport's old behavior of reporting to both channels —
// see deployer.Notifier's doc comment for the rate-limit reasoning.
func (b *Bot) pipelineChannels() []string {
	return []string{b.publicChannelID, b.privateChannelID}
}

func (b *Bot) SendPipelineMessage(ctx context.Context, s deployer.PipelineState) (map[string]string, error) {
	embed := b.buildPipelineEmbed(s)
	ids := make(map[string]string, 2)

	for _, channelID := range b.pipelineChannels() {
		msg, err := b.session.ChannelMessageSendComplex(channelID, &discordgo.MessageSend{
			Embeds: []*discordgo.MessageEmbed{embed},
		})
		if err != nil {
			log.Printf("sending pipeline message to channel %s: %v", channelID, err)
			continue
		}
		ids[channelID] = msg.ID
	}

	if len(ids) == 0 {
		return nil, fmt.Errorf("failed to send the pipeline message to any configured channel")
	}
	return ids, nil
}

func (b *Bot) UpdatePipelineMessage(ctx context.Context, s deployer.PipelineState) error {
	for channelID, messageID := range s.MessageIDs {
		b.enqueuePipelineEdit(channelID, messageID, s, false)
	}
	return nil
}

func (b *Bot) StartPipelineTick(s deployer.PipelineState) {
	key := pipelineTickKey(s.MessageIDs)
	if key == "" {
		return
	}

	b.tickMu.Lock()
	if _, exists := b.tickTimers[key]; exists {
		b.tickMu.Unlock()
		return
	}
	ticker := time.NewTicker(pipelineTickInterval)
	stop := make(chan struct{})
	b.tickTimers[key] = ticker
	b.tickStop[key] = stop
	b.tickMu.Unlock()

	go func() {
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				for channelID, messageID := range s.MessageIDs {
					b.enqueuePipelineEdit(channelID, messageID, s, true)
				}
			}
		}
	}()
}

func (b *Bot) StopPipelineTick(s deployer.PipelineState) {
	key := pipelineTickKey(s.MessageIDs)
	if key == "" {
		return
	}

	b.tickMu.Lock()
	defer b.tickMu.Unlock()
	if ticker, ok := b.tickTimers[key]; ok {
		ticker.Stop()
		close(b.tickStop[key])
		delete(b.tickTimers, key)
		delete(b.tickStop, key)
	}
}

// pipelineTickKey identifies one deploy's set of live messages for the
// tick-timer map — sorted-independent since a PipelineState's MessageIDs
// never changes membership after SendPipelineMessage populates it (only
// the values callers pass alongside it change), so simple concatenation in
// map-iteration order is stable enough within one process's lifetime for
// this single run (never compared across separate PipelineState values).
func pipelineTickKey(ids map[string]string) string {
	if len(ids) == 0 {
		return ""
	}
	var b strings.Builder
	for k, v := range ids {
		b.WriteString(k)
		b.WriteByte(':')
		b.WriteString(v)
		b.WriteByte(',')
	}
	return b.String()
}

// pipelineEdit is one queued edit for one message — see enqueuePipelineEdit.
type pipelineEdit struct {
	state  deployer.PipelineState
	isTick bool
}

// enqueuePipelineEdit serializes edits per message (channelID:messageID)
// so a burst of fast real stage transitions, or a tick landing at the same
// moment as a real transition, can never send overlapping/out-of-order
// PATCH requests to the same message — ported from the reference
// project's own discord.ts edit queue, which solved exactly this
// correctness property. A queued tick edit is dropped (never sent) if a
// real (non-tick) edit is already queued or in flight for the same
// message — the real edit already reflects whatever the tick would have
// shown, and a stale tick landing after it would visually revert the
// message for one PATCH cycle.
func (b *Bot) enqueuePipelineEdit(channelID, messageID string, s deployer.PipelineState, isTick bool) {
	key := channelID + ":" + messageID

	b.editMu.Lock()
	if isTick {
		hasRealEditQueued := false
		for _, e := range b.editQueues[key] {
			if !e.isTick {
				hasRealEditQueued = true
				break
			}
		}
		if hasRealEditQueued {
			b.editMu.Unlock()
			return
		}
		// Replace any existing queued tick with this newer one rather than
		// stacking multiple stale ticks behind each other.
		filtered := b.editQueues[key][:0]
		for _, e := range b.editQueues[key] {
			if !e.isTick {
				filtered = append(filtered, e)
			}
		}
		b.editQueues[key] = filtered
	}
	b.editQueues[key] = append(b.editQueues[key], pipelineEdit{state: s, isTick: isTick})
	b.editMu.Unlock()

	b.drainPipelineEditQueue(channelID, messageID, key)
}

func (b *Bot) drainPipelineEditQueue(channelID, messageID, key string) {
	b.editMu.Lock()
	if b.editBusy[key] {
		b.editMu.Unlock()
		return
	}
	b.editBusy[key] = true
	b.editMu.Unlock()

	defer func() {
		b.editMu.Lock()
		b.editBusy[key] = false
		b.editMu.Unlock()
	}()

	for {
		b.editMu.Lock()
		queue := b.editQueues[key]
		if len(queue) == 0 {
			b.editMu.Unlock()
			return
		}
		next := queue[0]
		b.editQueues[key] = queue[1:]
		b.editMu.Unlock()

		embed := b.buildPipelineEmbed(next.state)
		_, err := b.session.ChannelMessageEditComplex(&discordgo.MessageEdit{
			Channel: channelID,
			ID:      messageID,
			Embeds:  &[]*discordgo.MessageEmbed{embed},
		})
		if err != nil {
			log.Printf("editing pipeline message %s in channel %s: %v", messageID, channelID, err)
		}
	}
}

func (b *Bot) buildPipelineEmbed(s deployer.PipelineState) *discordgo.MessageEmbed {
	isTerminal := s.Stage == deployer.PipelineSuccess || s.Stage == deployer.PipelineFailed || s.Stage == deployer.PipelineCancelled
	elapsed := time.Duration(0)
	if !s.StartedAt.IsZero() {
		elapsed = time.Since(s.StartedAt)
	}

	statusWord := string(s.Stage)
	if !isTerminal {
		statusWord = fmt.Sprintf("%s (%s)", s.Stage, elapsed.Round(time.Second))
	}
	title := fmt.Sprintf("autodeploy — `%s` build #%s — %s", s.Branch, shortHash(s.CommitHash), statusWord)

	color := colorBlue
	switch s.Stage {
	case deployer.PipelineSuccess:
		color = colorGreen
	case deployer.PipelineFailed:
		color = colorRed
	case deployer.PipelineCancelled:
		color = colorYellow
	}

	order := []struct {
		stage deployer.PipelineStage
		label string
	}{
		{deployer.PipelinePulling, "Pull"},
		{deployer.PipelineBuilding, "Build"},
		{deployer.PipelineDeploying, "Deploy"},
	}

	var fields []*discordgo.MessageEmbedField
	stageIndex := func(stage deployer.PipelineStage) int {
		for i, o := range order {
			if o.stage == stage {
				return i
			}
		}
		return -1
	}

	// s.Stage is one of the three terminal outcomes (Success/Failed/
	// Cancelled) on a finished run, none of which has an entry in order
	// (those are the three per-field stages, not the outcomes) — so
	// stageIndex(s.Stage) alone would return -1 and every field would fall
	// through to "Pending" instead of showing which one actually failed or
	// was cancelled. deployer.go records exactly that in
	// PipelineState.FailedStage for both of those outcomes (see its own
	// doc comment) — used directly here rather than inferring it from
	// timing presence, which failed/finished stages can't be told apart by
	// on their own (both end up with a StageTiming, finished or not,
	// depending on exactly where in deployTo the outcome was reported).
	currentIdx := stageIndex(s.Stage)
	if s.Stage == deployer.PipelineFailed || s.Stage == deployer.PipelineCancelled {
		currentIdx = stageIndex(s.FailedStage)
	}

	for i, o := range order {
		timing := s.Timings[o.stage]
		isCompleted := i < currentIdx || s.Stage == deployer.PipelineSuccess
		isFailed := s.Stage == deployer.PipelineFailed && i == currentIdx
		isCancelled := s.Stage == deployer.PipelineCancelled && i == currentIdx
		isCurrent := i == currentIdx && !isTerminal

		emoji := b.stageEmoji("pending", "⬜")
		var value string
		switch {
		case isCompleted:
			emoji = b.stageEmoji("success", "✅")
			if timing != nil && !timing.StartedAt.IsZero() && !timing.FinishedAt.IsZero() {
				value = fmt.Sprintf("%s Success (%s)", emoji, timing.FinishedAt.Sub(timing.StartedAt).Round(time.Second))
			} else {
				value = fmt.Sprintf("%s Success", emoji)
			}
		case isFailed:
			emoji = b.stageEmoji("failed", "❌")
			if timing != nil && !timing.StartedAt.IsZero() {
				value = fmt.Sprintf("%s Failed (%s)", emoji, time.Since(timing.StartedAt).Round(time.Second))
			} else {
				value = fmt.Sprintf("%s Failed", emoji)
			}
		case isCancelled:
			emoji = b.stageEmoji("cancelled", "🚫")
			value = fmt.Sprintf("%s Cancelled", emoji)
		case isCurrent:
			emoji = b.stageEmoji(string(o.stage), "🟡")
			if timing != nil && !timing.StartedAt.IsZero() {
				value = fmt.Sprintf("%s Running (%s)", emoji, time.Since(timing.StartedAt).Round(time.Second))
			} else {
				value = fmt.Sprintf("%s Running", emoji)
			}
		default:
			value = fmt.Sprintf("%s Pending", emoji)
		}

		fields = append(fields, &discordgo.MessageEmbedField{Name: o.label, Value: value})
	}

	if isTerminal {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:  "​",
			Value: fmt.Sprintf("**Author:** %s  •  **Total:** %s", s.Author, elapsed.Round(time.Second)),
		})
	}

	description := pipelineDescription(s)
	if s.Error != "" {
		description += "\n```\n" + truncateTail(s.Error, maxFieldLength) + "\n```"
	}

	return &discordgo.MessageEmbed{
		Title:       title,
		Description: description,
		Color:       color,
		Fields:      fields,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
}

// pipelineDescription renders every commit in s.Commits (not just the
// newest one — see PipelineState.Commits's own doc comment on why a single
// CommitSubject/Author pair isn't enough here) as a diff-style changelog,
// followed by a per-file +/-/~ summary from s.FileChanges. Matches
// changelogText's own commit-list format below (used by the separate
// approval-gate message) for one consistent look across both message
// kinds, plus the file list changelogText doesn't need.
func pipelineDescription(s deployer.PipelineState) string {
	// Discord embed descriptions cap at 4096 characters total — this
	// budgets roughly half to commits and half to file changes rather
	// than letting either one alone exhaust the limit and silently push
	// the other out, then truncates each independently to its share.
	const maxDescriptionLength = 4000
	const commitBudget = maxDescriptionLength / 2
	const fileBudget = maxDescriptionLength - commitBudget

	var b strings.Builder

	if len(s.Commits) > 0 {
		b.WriteString(fmt.Sprintf("**%d commit(s):**\n", len(s.Commits)))
		b.WriteString("```diff\n")
		for _, c := range s.Commits {
			fmt.Fprintf(&b, "+ %s  %s — %s\n", c.ShortHash, c.Subject, c.Author)
		}
		b.WriteString("```\n")
	}
	commitSection := b.String()
	if len(commitSection) > commitBudget {
		commitSection = commitSection[:commitBudget] + "\n...(truncated)\n"
	}

	var fb strings.Builder
	if len(s.FileChanges) > 0 {
		fmt.Fprintf(&fb, "**%d file(s) changed:**\n```diff\n", len(s.FileChanges))
		for _, c := range s.FileChanges {
			switch c.Status {
			case git.FileRenamed:
				fmt.Fprintf(&fb, "%s %s -> %s\n", c.Symbol(), c.OldPath, c.Path)
			default:
				fmt.Fprintf(&fb, "%s %s\n", c.Symbol(), c.Path)
			}
		}
		fb.WriteString("```")
	}
	fileSection := fb.String()
	if len(fileSection) > fileBudget {
		fileSection = fileSection[:fileBudget] + "\n...(truncated)\n```"
	}

	return commitSection + fileSection
}

// stageEmoji returns the resolved custom emoji for key (a stage name, or
// "pending"/"success"/"failed"), falling back to fallback when none was
// configured or resolution failed for it — see loadStageEmojis.
func (b *Bot) stageEmoji(key, fallback string) string {
	if b.stageEmojis == nil {
		return fallback
	}
	if e, ok := b.stageEmojis[key]; ok {
		return e
	}
	return fallback
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
