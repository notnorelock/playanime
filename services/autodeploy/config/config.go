// Package config loads autodeploy's JSON config file.
//
// Unlike services/webserver (env vars, matching the rest of this
// monorepo's convention), this daemon deliberately uses a JSON file — the
// user asked for it specifically, and a GitHub token with real repo access
// benefits from living in one file with restrictive permissions
// (0600, see Load) rather than in process environment, which any other
// process running as the same user can read via /proc.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	// RepoPath is the absolute path to the git working copy to poll and
	// deploy from, e.g. "/root/playanime".
	RepoPath string `json:"repoPath"`
	// Branch is the branch to track, e.g. "master". Defaults to whatever
	// the repo's current branch is if empty.
	Branch string `json:"branch"`
	// GitHubToken authenticates `git fetch`/`git pull` against a private
	// repo. Fine-grained PAT, read-only, scoped to this one repo — see
	// infrastructure/docker/README.md's "Cloning a private repo on the
	// VPS" section for how to create one. Injected into the remote URL for
	// each git operation, never written to .git/config (see git.go).
	GitHubToken string `json:"githubToken"`
	// PollIntervalSeconds is how often to check for new commits. The user
	// asked for "every 2/3 minutes" — default 150s (2.5 min) if unset or 0.
	PollIntervalSeconds int `json:"pollIntervalSeconds"`
	// DeployScript is the path to deploy.sh, relative to RepoPath.
	// Defaults to "infrastructure/docker/deploy.sh".
	DeployScript string `json:"deployScript"`
	// StateFile is where the approval workflow's persisted state lives
	// (last acknowledged commit, any outstanding pending approval — see
	// package state). Defaults to "autodeploy.state.json" next to the
	// config file's own working directory. Only meaningful with Discord
	// bot mode; the webhook-only fallback mode doesn't use it.
	StateFile string `json:"stateFile"`
	// DeployTimeoutSeconds caps how long a single deploy.sh run may take
	// before autodeploy kills it and reports a failure. Defaults to 600 (10
	// minutes) — generous for a build-from-scratch, but not infinite: a
	// hung deploy.sh (e.g. its own confirmation prompt from the
	// behind-remote check, if HEAD somehow diverges from what was just
	// pulled) would otherwise block every future poll forever.
	DeployTimeoutSeconds int `json:"deployTimeoutSeconds"`
	// DiscordWebhookURL is a fallback notification path used ONLY when
	// Discord.Enabled() is false — a simple "deploy succeeded/failed"
	// webhook post with no approval gate, no buttons, no channel split
	// (the original, simpler mode this daemon started as). Once the bot is
	// configured, this is ignored entirely in favor of the two-channel
	// approval workflow below.
	DiscordWebhookURL string `json:"discordWebhookUrl"`

	// Discord holds the bot's own credentials, channels, and command
	// permissions. Optional as a whole — omit it (or leave BotToken empty)
	// to fall back to DiscordWebhookURL's simpler always-auto-deploy mode.
	Discord DiscordBotConfig `json:"discord"`

	// Webhook holds the GitHub webhook listener's own config — an
	// optional, additive fast-trigger path alongside the existing
	// PollIntervalSeconds ticker (which keeps running either way, as a
	// fallback for a dropped delivery or a misconfigured secret). See
	// WebhookConfig's own doc comments.
	Webhook WebhookConfig `json:"webhook"`

	// SelfImage is this autodeploy container's own image reference (must
	// match whatever infrastructure/docker/docker-compose.prod.yml
	// actually builds/tags the autodeploy service as, e.g.
	// "playanime-autodeploy:latest") — used to launch the detached
	// sibling container that runs deploy.sh, see deploy.StartDetached.
	// Passed in explicitly rather than introspected from inside the
	// running container (which would need reading /proc/self/cgroup or a
	// `docker inspect` of this container's own hostname) because it's a
	// static, one-time-to-configure value and introspection adds moving
	// parts for no real benefit. Required — see Load.
	SelfImage string `json:"selfImage"`
	// RedisURL enables deploy-in-progress coordination across autodeploy
	// restarts (see package redisstate) — optional. When empty, deploys
	// still run in a detached sibling container (see deploy.StartDetached)
	// but a replacement autodeploy process has no way to rediscover one
	// still running after its own container gets recreated mid-deploy
	// (see README.md's former "Known quirk" section, now fixed only when
	// this is set). Same connection string shape already used elsewhere
	// in this stack, e.g. "redis://redis:6379" (see .env.prod.example's
	// REDIS_URL).
	RedisURL string `json:"redisUrl"`
}

type WebhookConfig struct {
	// Enabled turns the HTTP listener on at all. Off by default — an
	// existing polling-only deployment is completely unaffected until this
	// is explicitly set.
	Enabled bool `json:"enabled"`
	// Secret is the shared secret configured on the GitHub webhook itself
	// (repo Settings -> Webhooks -> Add webhook -> Secret). Used to verify
	// the X-Hub-Signature-256 header on every delivery via HMAC-SHA256 —
	// see webhook/webhook.go. Required whenever Enabled is true: an empty
	// secret would mean accepting any POST to this endpoint as a real
	// GitHub delivery, which is refused at startup rather than silently
	// running unauthenticated.
	Secret string `json:"secret"`
	// Port is the loopback-only TCP port the listener binds
	// (127.0.0.1:Port — never a public interface; only Caddy, reverse-
	// proxying from inside the Docker network, is meant to reach this).
	// Defaults to 8787 if unset or 0.
	Port int `json:"port"`
}

func (w WebhookConfig) ListenPort() int {
	if w.Port <= 0 {
		return 8787
	}
	return w.Port
}

type DiscordBotConfig struct {
	// BotToken authenticates the bot connection. From the Discord Developer
	// Portal (discord.com/developers/applications) → your application →
	// Bot → Reset Token. Different from DiscordWebhookURL above and from a
	// user token — this is specifically a bot token, and the application
	// needs the "applications.commands" and "bot" scopes with the
	// "Send Messages" and "Mention @everyone, @here, and All Roles"
	// permissions (the last one is what lets it actually ping
	// AllowedRoleIDs, not just link it) when you generate its invite URL.
	BotToken string `json:"botToken"`
	// GuildID is the Discord server (guild) ID to register /deploy and
	// /status in. Slash commands registered to one guild appear
	// instantly; global commands (GuildID empty) can take up to an hour
	// to propagate — a guild ID is recommended for exactly that reason.
	// Right-click your server icon in Discord (Developer Mode must be on
	// in Settings → Advanced) → Copy Server ID.
	GuildID string `json:"guildId"`
	// AllowedRoleIDs gates /deploy and the Approve/Skip buttons (not
	// /status, which is read-only) to members holding at least one of
	// these roles — a member needs only one, not all of them. Comma
	// -separated, e.g. "111111111111111111,222222222222222222". Right
	// -click each role in Server Settings → Roles → Copy Role ID.
	AllowedRoleIDs string `json:"allowedRoleIds"`
	// PublicChannelID gets a short build-report message per deploy attempt
	// (pull/build/deploy steps, commit, author, duration) — meant for a
	// channel anyone in the server can see, no ping. Right-click the
	// channel → Copy Channel ID.
	PublicChannelID string `json:"publicChannelId"`
	// PrivateChannelID gets the approval request (changelog since the last
	// acknowledged commit, Approve/Skip buttons, pings AllowedRoleIDs) and
	// the same live per-stage pipeline message the public channel gets,
	// plus the full deploy output on failure. Meant for a channel only the
	// dev role can see.
	PrivateChannelID string `json:"privateChannelId"`
	// StageEmojis maps a pipeline stage — one of "pulling", "building",
	// "deploying", "pending", "success", "failed" — to a custom guild
	// emoji's NAME (not its ID or <:name:id> mention syntax), resolved
	// against the guild's real emoji list once at startup (see
	// notify/emoji.go's loadStageEmojis). Named rather than by ID so the
	// config file stays readable and doesn't need updating if an emoji is
	// ever re-uploaded with a new ID. Optional per key and as a whole —
	// any stage without an entry, or whose name doesn't match a real guild
	// emoji, falls back to a plain Unicode emoji instead.
	StageEmojis map[string]string `json:"stageEmojis"`
}

// Enabled reports whether the Discord bot (and with it, the approval-gate
// workflow) should run at all.
func (d DiscordBotConfig) Enabled() bool {
	return d.BotToken != ""
}

// Roles splits AllowedRoleIDs on commas, trimming whitespace and dropping
// empty entries — so "id1, id2," or "id1,,id2" both parse to just the two
// real IDs instead of also producing a bogus empty-string "role."
func (d DiscordBotConfig) Roles() []string {
	var roles []string
	for _, id := range strings.Split(d.AllowedRoleIDs, ",") {
		id = strings.TrimSpace(id)
		if id != "" {
			roles = append(roles, id)
		}
	}
	return roles
}

func (c *Config) PollInterval() time.Duration {
	if c.PollIntervalSeconds <= 0 {
		return 150 * time.Second
	}
	return time.Duration(c.PollIntervalSeconds) * time.Second
}

func (c *Config) DeployTimeout() time.Duration {
	if c.DeployTimeoutSeconds <= 0 {
		return 10 * time.Minute
	}
	return time.Duration(c.DeployTimeoutSeconds) * time.Second
}

func (c *Config) DeployScriptPath() string {
	if c.DeployScript == "" {
		return "infrastructure/docker/deploy.sh"
	}
	return c.DeployScript
}

func (c *Config) StateFilePath() string {
	if c.StateFile == "" {
		return "autodeploy.state.json"
	}
	return c.StateFile
}

// Load reads and validates the config file at path. Refuses a config file
// that isn't owner-only-readable (0600 or stricter) when running on a
// platform where that's meaningful — this file holds a real GitHub token,
// and a world- or group-readable config for it defeats half the point of
// scoping the token narrowly in the first place.
func Load(path string) (*Config, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("config file %s: %w", path, err)
	}

	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf(
			"config file %s is readable by group/other (mode %#o) — this file holds a GitHub token; run: chmod 600 %s",
			path, info.Mode().Perm(), path,
		)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file %s: %w", path, err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config file %s: %w", path, err)
	}

	if cfg.RepoPath == "" {
		return nil, fmt.Errorf("config: repoPath is required")
	}
	if cfg.GitHubToken == "" {
		return nil, fmt.Errorf("config: githubToken is required (a fine-grained PAT, read-only, scoped to this repo)")
	}
	if cfg.SelfImage == "" {
		return nil, fmt.Errorf("config: selfImage is required — the image reference docker-compose.prod.yml builds/tags the autodeploy service as, used to launch the detached deploy.sh container (see deploy.StartDetached)")
	}
	if cfg.Discord.Enabled() {
		if cfg.Discord.GuildID == "" {
			return nil, fmt.Errorf("config: discord.guildId is required when discord.botToken is set")
		}
		if len(cfg.Discord.Roles()) == 0 {
			return nil, fmt.Errorf("config: discord.allowedRoleIds is required when discord.botToken is set — an unrestricted /deploy would let any server member trigger a production deploy")
		}
		if cfg.Discord.PublicChannelID == "" {
			return nil, fmt.Errorf("config: discord.publicChannelId is required when discord.botToken is set")
		}
		if cfg.Discord.PrivateChannelID == "" {
			return nil, fmt.Errorf("config: discord.privateChannelId is required when discord.botToken is set")
		}
	}

	if cfg.Webhook.Enabled && cfg.Webhook.Secret == "" {
		return nil, fmt.Errorf("config: webhook.secret is required when webhook.enabled is true - an empty secret would accept any POST as a real GitHub delivery")
	}

	return &cfg, nil
}
