// Package redisstate persists which detached deploy container (if any) is
// currently running, so a replacement autodeploy process — recreated by
// its own self-redeploy, see deployer.Deployer's "Known quirk" doc
// comment — can rediscover it, reattach to its output, and keep driving
// the existing live Discord pipeline embed instead of losing track of the
// run or starting a conflicting second one.
//
// Deliberately holds no dependency on package deployer (Stage is a plain
// string, not deployer.PipelineStage) — the same one-way-dependency
// reasoning deployer.Notifier's own doc comment gives for not importing
// notify: deployer is what imports this package, not the other way
// around.
package redisstate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// activeDeployKey is a single fixed key, not a set/list — only one deploy
// can be in progress at a time (Deployer.inProgress already enforces
// this), so there is never more than one record to track.
const activeDeployKey = "autodeploy:active-deploy"

// DeployRecord is everything a replacement autodeploy process needs to
// reattach to an in-flight detached deploy and keep editing its existing
// live Discord embed — see deploy.StartDetached/StreamLogs for how the
// container itself is launched and scanned, and deployer.Reattach for how
// this record is turned back into a deployer.PipelineState.
type DeployRecord struct {
	ContainerID   string            `json:"containerId"`
	TargetCommit  string            `json:"targetCommit"`
	StartedAt     time.Time         `json:"startedAt"`
	// Stage is the last known deployer.PipelineStage value, as a plain
	// string — see the package doc comment for why this package doesn't
	// import deployer to use its type directly.
	Stage         string            `json:"stage"`
	CommitSubject string            `json:"commitSubject"`
	Author        string            `json:"author"`
	Branch        string            `json:"branch"`
	// MessageIDs is channelID -> messageID for the live pipeline embed
	// already posted for this run — mirrors deployer.PipelineState's own
	// field of the same name and meaning. A reattaching process edits
	// these same messages rather than posting new ones.
	MessageIDs map[string]string `json:"messageIds"`
}

// Client wraps a *redis.Client for autodeploy's one use of Redis. New
// fails fast at construction (a bad URL, an unreachable host at startup
// when RedisURL is misconfigured) rather than surfacing as a mysterious
// failure on the first real deploy — mirrors state.Open's own
// fail-at-startup shape.
type Client struct {
	rdb *redis.Client
}

// New parses redisURL (e.g. "redis://redis:6379", the same shape already
// used by REDIS_URL elsewhere in this stack — see .env.prod.example) and
// pings the server once to confirm it's reachable before returning.
func New(ctx context.Context, redisURL string) (*Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parsing redis url: %w", err)
	}

	rdb := redis.NewClient(opts)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("connecting to redis: %w", err)
	}

	return &Client{rdb: rdb}, nil
}

func (c *Client) Close() error {
	return c.rdb.Close()
}

// Set writes rec, replacing whatever record (if any) was there before,
// expiring after ttl. The TTL is a safety net for a crashed process that
// never reached Clear — not the primary correctness mechanism, which is
// deployer.Reattach actually checking (via `docker inspect`/StreamLogs)
// whether ContainerID is still running before trusting this record.
func (c *Client) Set(ctx context.Context, rec DeployRecord, ttl time.Duration) error {
	encoded, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("encoding deploy record: %w", err)
	}
	if err := c.rdb.Set(ctx, activeDeployKey, encoded, ttl).Err(); err != nil {
		return fmt.Errorf("writing deploy record: %w", err)
	}
	return nil
}

// Get returns the current record, or found=false if none exists (the
// common case — no deploy in progress).
func (c *Client) Get(ctx context.Context) (rec DeployRecord, found bool, err error) {
	raw, err := c.rdb.Get(ctx, activeDeployKey).Bytes()
	if errors.Is(err, redis.Nil) {
		return DeployRecord{}, false, nil
	}
	if err != nil {
		return DeployRecord{}, false, fmt.Errorf("reading deploy record: %w", err)
	}

	if err := json.Unmarshal(raw, &rec); err != nil {
		return DeployRecord{}, false, fmt.Errorf("parsing deploy record: %w", err)
	}
	return rec, true, nil
}

// Refresh bumps the record's TTL without changing its value — called
// alongside the existing pipeline tick (see
// deployer.Notifier.StartPipelineTick) so a long-running deploy's record
// never expires out from under it while it's still genuinely in
// progress.
func (c *Client) Refresh(ctx context.Context, ttl time.Duration) error {
	if err := c.rdb.Expire(ctx, activeDeployKey, ttl).Err(); err != nil {
		return fmt.Errorf("refreshing deploy record ttl: %w", err)
	}
	return nil
}

// Clear removes the record — called once a deploy reaches any terminal
// state (success, failure, or cancellation) so the record never outlives
// the run it describes.
func (c *Client) Clear(ctx context.Context) error {
	if err := c.rdb.Del(ctx, activeDeployKey).Err(); err != nil {
		return fmt.Errorf("clearing deploy record: %w", err)
	}
	return nil
}
