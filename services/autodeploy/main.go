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
// in this directory for how this runs as its own container
// (infrastructure/docker/Dockerfile.autodeploy) alongside the rest of the
// stack it deploys.
package main

import (
	"context"
	"flag"
	"log"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"playanime/autodeploy/config"
	"playanime/autodeploy/deployer"
	"playanime/autodeploy/git"
	"playanime/autodeploy/notify"
	"playanime/autodeploy/redisstate"
	"playanime/autodeploy/state"
	"playanime/autodeploy/webhook"
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

	// redisClient is nil when cfg.RedisURL is unset — deploy-in-progress
	// reattachment across autodeploy restarts is an additive safety net
	// (see config.Config.RedisURL's own doc comment), not a hard
	// requirement, so its absence never blocks startup. When RedisURL IS
	// set, a bad URL or an unreachable Redis at startup fails fast here
	// (mirroring state.Open above) rather than surfacing as a confusing
	// failure on the first real deploy.
	var redisClient *redisstate.Client
	if cfg.RedisURL != "" {
		redisClient, err = redisstate.New(ctx, cfg.RedisURL)
		if err != nil {
			log.Fatalf("connecting to redis: %v", err)
		}
		defer redisClient.Close()
	}

	var d *deployer.Deployer
	var bot *notify.Bot

	if cfg.Discord.Enabled() {
		bot, err = notify.NewBot(cfg.Discord.BotToken, cfg.Discord.GuildID, cfg.Discord.Roles(), cfg.Discord.PublicChannelID, cfg.Discord.PrivateChannelID, cfg.Discord.StageEmojis)
		if err != nil {
			log.Fatalf("setting up discord bot: %v", err)
		}
		d = deployer.New(repo, branch, cfg, store, bot, redisClient)
		bot.SetDeployer(d)

		if err := bot.Start(); err != nil {
			log.Fatalf("starting discord bot: %v", err)
		}
		defer bot.Stop()

		log.Println("approval-gate mode: new commits will wait for /deploy or an Approve/Skip button, not deploy automatically")
	} else {
		discord := notify.NewDiscord(cfg.DiscordWebhookURL)
		d = deployer.New(repo, branch, cfg, store, notify.NewLegacyNotifier(discord), redisClient)
		log.Println("webhook-only mode: new commits deploy automatically on every poll (no discord.botToken configured)")
	}

	// Reattach picks back up a deploy that was still in flight in its own
	// detached container when a PREVIOUS autodeploy process (almost always
	// this same container, recreated mid-deploy by its own self-redeploy —
	// see README.md's "Deploy-in-progress coordination" section) never got
	// to see finish. A no-op when redisClient is nil or nothing was
	// in-flight.
	if err := d.Reattach(ctx); err != nil {
		log.Printf("reattaching to in-progress deploy: %v", err)
	}

	interval := cfg.PollInterval()
	log.Printf("autodeploy started — watching %s (branch %s), polling every %s", cfg.RepoPath, branch, interval)

	var wg sync.WaitGroup
	// The GitHub webhook listener (config.WebhookConfig) is a fast-trigger
	// path ADDITIONAL to the polling loop below, not a replacement for
	// it — polling keeps running exactly as before so a dropped webhook
	// delivery or a misconfigured secret still self-heals within one poll
	// interval. Not to be confused with cfg.DiscordWebhookURL above
	// (an outgoing Discord notification target, unrelated).
	if cfg.Webhook.Enabled {
		server := webhook.NewServer(cfg.Webhook.ListenPort(), cfg.Webhook.Secret, branch, d)
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := server.Start(ctx); err != nil {
				log.Printf("webhook server: %v", err)
			}
		}()
		log.Printf("github webhook listener started on 0.0.0.0:%d (branch %s) — see infrastructure/docker/Caddyfile for ci.playani.me", cfg.Webhook.ListenPort(), branch)
	}

	pollOnce(ctx, d)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

loop:
	for {
		select {
		case <-ctx.Done():
			log.Println("shutting down")
			break loop
		case <-ticker.C:
			pollOnce(ctx, d)
		}
	}

	wg.Wait()
}

func pollOnce(ctx context.Context, d *deployer.Deployer) {
	if err := d.Poll(ctx); err != nil {
		log.Printf("poll failed: %v", err)
	}
}
