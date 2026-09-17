// autodeploy polls this repo's git remote every few minutes and, when it
// finds new commits, either deploys them right away (webhook-only fallback
// mode) or posts an approval request to a private Discord channel and
// waits for a dev-role member to click Approve or Skip (bot mode) — see
// config.DiscordBotConfig. Either way this replaces the manual
// `git pull && ./deploy.sh`, which is easy to run half of by mistake (see
// the deploy-forgot-git-pull incident this exists to close off).
//
// Usage:
//
//	go build -o autodeploy .
//	./autodeploy -config /path/to/autodeploy.config.json
//
// See autodeploy.config.example.json for the config shape, and README.md
// in this directory for the full systemd-service setup on the VPS.
package main

import (
	"context"
	"flag"
	"log"
	"os/signal"
	"syscall"
	"time"

	"playanime/autodeploy/config"
	"playanime/autodeploy/deployer"
	"playanime/autodeploy/git"
	"playanime/autodeploy/notify"
	"playanime/autodeploy/state"
)

func main() {
	configPath := flag.String("config", "autodeploy.config.json", "path to the JSON config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	repo := &git.Repo{Path: cfg.RepoPath, Branch: cfg.Branch, Token: cfg.GitHubToken}

	branch := cfg.Branch
	if branch == "" {
		branch, err = repo.CurrentBranch(ctx)
		if err != nil {
			log.Fatalf("determining current branch: %v", err)
		}
		log.Printf("no branch configured — tracking current branch %q", branch)
	}

	store, err := state.Open(cfg.StateFilePath())
	if err != nil {
		log.Fatalf("loading state: %v", err)
	}

	var d *deployer.Deployer
	var bot *notify.Bot

	if cfg.Discord.Enabled() {
		bot, err = notify.NewBot(cfg.Discord.BotToken, cfg.Discord.GuildID, cfg.Discord.Roles(), cfg.Discord.PublicChannelID, cfg.Discord.PrivateChannelID, cfg.Discord.StageEmojis)
		if err != nil {
			log.Fatalf("setting up discord bot: %v", err)
		}
		d = deployer.New(repo, branch, cfg, store, bot)
		bot.SetDeployer(d)

		if err := bot.Start(); err != nil {
			log.Fatalf("starting discord bot: %v", err)
		}
		defer bot.Stop()

		log.Println("approval-gate mode: new commits will wait for /deploy or an Approve/Skip button, not deploy automatically")
	} else {
		discord := notify.NewDiscord(cfg.DiscordWebhookURL)
		d = deployer.New(repo, branch, cfg, store, notify.NewLegacyNotifier(discord))
		log.Println("webhook-only mode: new commits deploy automatically on every poll (no discord.botToken configured)")
	}

	interval := cfg.PollInterval()
	log.Printf("autodeploy started — watching %s (branch %s), polling every %s", cfg.RepoPath, branch, interval)

	pollOnce(ctx, d)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("shutting down")
			return
		case <-ticker.C:
			pollOnce(ctx, d)
		}
	}
}

func pollOnce(ctx context.Context, d *deployer.Deployer) {
	if err := d.Poll(ctx); err != nil {
		log.Printf("poll failed: %v", err)
	}
}
