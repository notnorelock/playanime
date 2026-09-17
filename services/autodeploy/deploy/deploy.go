// Package deploy runs the repo's own deploy.sh — as a detached sibling
// Docker container, not an in-process child — and streams/captures its
// result.
//
// Why detached rather than a direct os/exec child (the original design):
// autodeploy runs as its own container (infrastructure/docker/
// Dockerfile.autodeploy) with the host's Docker socket mounted, and a
// deploy that changes autodeploy's own code causes deploy.sh's own
// `docker compose up -d` to recreate the very autodeploy container that
// launched it (see services/autodeploy/README.md's former "Known quirk"
// section). A direct child process dies the instant its container is
// torn down — Docker removes the whole PID namespace on container
// removal, which no amount of process-group/session detachment
// (setsid and similar) can survive, since that only escapes the
// *session*, not the *PID namespace* — confirmed directly before this
// package was rewritten around it. Running deploy.sh in a genuinely
// separate, independently-tracked container is the only thing that
// survives autodeploy's own container being replaced mid-run; see
// redisstate and deployer.Deployer.Reattach for how a replacement
// autodeploy process rediscovers and reattaches to it.
package deploy

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Result struct {
	Success  bool
	Output   string
	Duration time.Duration
}

// Stage is a point deploy.sh reaches during a run, signaled back to Go via
// a marker line on stdout — see markerPrefix below and
// infrastructure/docker/deploy.sh's own comment on the exact same lines.
type Stage string

const (
	StageBuilding  Stage = "building"
	StageDeploying Stage = "deploying"
	StageHealthy   Stage = "healthy"
)

// StageEvent is passed to StreamLogs's onStage callback each time a marker
// line is seen on stdout, in the order deploy.sh actually printed them.
type StageEvent struct {
	Stage Stage
	At    time.Time
}

// markerPrefix must match the literal string infrastructure/docker/deploy.sh
// echoes before each stage — see that file's own comment on this exact
// contract. A line matching this prefix is never written into the visible
// Output buffer (so it can't leak into a failure-tail embed as noise); a
// prefix with no matching Stage constant below is silently ignored rather
// than treated as an error, so deploy.sh gaining new informational markers
// later doesn't require an autodeploy release in lockstep.
const markerPrefix = "::autodeploy:stage:"

func parseMarker(line string) (Stage, bool) {
	if !strings.HasPrefix(line, markerPrefix) {
		return "", false
	}
	rest := strings.TrimPrefix(line, markerPrefix)
	name, ok := strings.CutSuffix(rest, "::")
	if !ok {
		return "", false
	}
	switch Stage(name) {
	case StageBuilding, StageDeploying, StageHealthy:
		return Stage(name), true
	default:
		return "", false
	}
}

// syncBuffer guards a bytes.Buffer with a mutex. Needed here specifically
// because stdout is consumed manually via StdoutPipe (so the marker-line
// scan can run in this goroutine) while stderr is still handed to cmd as a
// plain io.Writer, which os/exec drains on its own internal goroutine —
// os/exec only synchronizes Stdout/Stderr writes for the caller when both
// are literally the same io.Writer *and* accessed exclusively through
// os/exec's own machinery, which does not hold once one of the two streams
// is being read via a pipe by application code instead. Without this,
// output.WriteString from the scan loop and cmd's internal stderr-copying
// goroutine would race on the same bytes.Buffer.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuffer) WriteLine(line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf.WriteString(line)
	s.buf.WriteByte('\n')
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

// StartDetached launches deploy.sh inside a new detached sibling
// container built from selfImage (autodeploy's own image — see
// config.Config.SelfImage's doc comment for why this is configured rather
// than introspected), returning its container ID immediately without
// waiting for it to finish. The container gets the exact same Docker
// socket and repo bind mount autodeploy's own container has (see
// docker-compose.prod.yml's autodeploy service) — deploy.sh needs both to
// run `docker compose build/up` against the host daemon, exactly as it
// already does when invoked in-process.
//
// The container name is derived from targetCommit and the current time so
// concurrent/rapid calls never collide and a name is still recognizable
// via a plain `docker ps` — deployer.Deployer.inProgress already prevents
// two deploys from actually running at once, so collision-avoidance here
// is a low-stakes nicety, not a correctness requirement.
func StartDetached(ctx context.Context, repoPath, scriptPath, selfImage, targetCommit string) (containerID string, err error) {
	name := fmt.Sprintf("autodeploy-run-%s-%d", shortCommit(targetCommit), time.Now().Unix())

	args := []string{
		"run", "-d",
		"--name", name,
		"-v", "/var/run/docker.sock:/var/run/docker.sock",
		"-v", fmt.Sprintf("%s:%s", repoPath, repoPath),
		"-w", repoPath,
		selfImage,
		"bash", scriptPath,
	}

	cmd := exec.CommandContext(ctx, "docker", args...)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("docker run failed: %w (stderr: %s)", err, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("docker run failed: %w", err)
	}

	id := strings.TrimSpace(string(out))
	if id == "" {
		return "", fmt.Errorf("docker run returned no container id")
	}
	return id, nil
}

func shortCommit(commit string) string {
	if len(commit) > 12 {
		return commit[:12]
	}
	return commit
}

// StreamLogs follows containerID's combined output (`docker logs -f`)
// until the container stops producing output (it exits, or ctx is
// cancelled), scanning line-by-line for the same stage markers
// deploy.sh's own comment documents. Used both right after StartDetached
// (a fresh run, in the same process) and by deployer.Deployer.Reattach
// (a replacement process picking a still-running container back up) — the
// exact same scanning logic either way, so there is exactly one place
// that knows how to interpret deploy.sh's stdout.
//
// onStage is called synchronously, in stdout order; nil is fine when the
// caller only wants raw output. onLine is called for every non-marker
// line, letting the caller accumulate output however it wants (a fresh
// run needs the full transcript from the start; a reattach only has
// whatever's left to stream from this point on, which is an accepted,
// documented gap in what a reattached run can report — see
// deployer.Deployer.Reattach's own comment).
func StreamLogs(ctx context.Context, containerID string, onStage func(StageEvent), onLine func(string)) error {
	cmd := exec.CommandContext(ctx, "docker", "logs", "-f", containerID)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("creating stdout pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout // docker logs -f interleaves both; caller only needs one ordered stream

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("starting docker logs -f: %w", err)
	}

	scanner := bufio.NewScanner(stdoutPipe)
	// deploy.sh's own docker compose build/up output can print very long
	// lines (a full image layer digest list on one line, in some Docker
	// versions) — bufio.Scanner's 64KB default token limit would otherwise
	// silently truncate the scan (and lose the rest of that run's stdout)
	// on the first such line. 1MB comfortably covers it.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		if stage, ok := parseMarker(line); ok {
			if onStage != nil {
				onStage(StageEvent{Stage: stage, At: time.Now()})
			}
			continue
		}

		if onLine != nil {
			onLine(line)
		}
	}
	// A scan error here (e.g. the container died mid-line) isn't fatal to
	// reporting a result — Wait (called by the caller right after this
	// returns) still gets the container's real exit code, which is what
	// actually determines success; losing the last partial line of output
	// is an acceptable trade for not needing a second error path here.
	_ = scanner.Err()

	// cmd.Wait here only reaps the `docker logs -f` client process itself
	// (which exits once the container stops producing output) — it is NOT
	// the deployed container's own exit status; see Wait below for that.
	_ = cmd.Wait()

	return nil
}

// Wait blocks until containerID exits (`docker wait`), returning its exit
// code. Call after StreamLogs returns (or concurrently with it — both
// operate on the same already-running container independently) to learn
// whether deploy.sh actually succeeded.
func Wait(ctx context.Context, containerID string) (exitCode int, err error) {
	cmd := exec.CommandContext(ctx, "docker", "wait", containerID)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("docker wait failed: %w", err)
	}

	code, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return 0, fmt.Errorf("parsing docker wait output %q: %w", out, err)
	}
	return code, nil
}

// Cleanup removes containerID (`docker rm`) — call once it has exited
// (Wait has returned), never before.
func Cleanup(ctx context.Context, containerID string) error {
	cmd := exec.CommandContext(ctx, "docker", "rm", containerID)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("docker rm failed: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// IsRunning reports whether containerID currently exists and is running —
// used by deployer.Deployer.Reattach to decide whether a Redis-recorded
// deploy is still actually in flight (case 2, reattach) or has genuinely
// died along with whatever process was tracking it before (case 3, treat
// as failed and let the poll loop start fresh) — see redisstate's package
// doc comment for the fuller reasoning.
func IsRunning(ctx context.Context, containerID string) (bool, error) {
	cmd := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", containerID)
	out, err := cmd.Output()
	if err != nil {
		// docker inspect exits non-zero when the container doesn't exist at
		// all — that's a normal "not running" answer here, not a real
		// error, since the whole point of this call is to tolerate the
		// container having vanished (host reboot, manual cleanup, etc.).
		return false, nil
	}
	return strings.TrimSpace(string(out)) == "true", nil
}
