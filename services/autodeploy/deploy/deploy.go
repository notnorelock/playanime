// Package deploy runs the repo's own deploy.sh and captures its result.
package deploy

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
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

// StageEvent is passed to Run's onStage callback each time a marker line is
// seen on stdout, in the order deploy.sh actually printed them.
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

// Run executes scriptPath (relative to repoPath) with bash, piping "y\n"
// to stdin so deploy.sh's own behind-remote-check confirmation prompt
// (see infrastructure/docker/deploy.sh) can never hang this indefinitely —
// autodeploy always deploys immediately after a fresh pull, so that
// checkout is never behind by the time this runs, but answering "y"
// automatically closes off the one way a race there could otherwise wedge
// this goroutine.
//
// onStage is called synchronously, in stdout order, each time deploy.sh
// prints a stage marker — nil is fine when the caller only wants the final
// Result (e.g. the webhook-only fallback mode, which has no live message to
// update). Called from the same goroutine that reads the process's stdout,
// never concurrently with itself.
func Run(ctx context.Context, repoPath, scriptPath string, timeout time.Duration, onStage func(StageEvent)) Result {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()

	cmd := exec.CommandContext(runCtx, "bash", filepath.Join(repoPath, scriptPath))
	cmd.Dir = repoPath
	cmd.Stdin = bytes.NewBufferString("y\n")

	output := &syncBuffer{}

	// stdout is scanned line-by-line for stage markers and otherwise copied
	// into the same accumulator stderr writes into (via os/exec's own
	// goroutine) — see syncBuffer's doc comment for why that accumulator
	// needs its own lock here, unlike the single-io.Writer version this
	// replaced.
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return Result{Success: false, Output: fmt.Sprintf("creating stdout pipe: %v", err), Duration: time.Since(started)}
	}
	cmd.Stderr = output

	if err := cmd.Start(); err != nil {
		return Result{Success: false, Output: fmt.Sprintf("starting %s: %v", scriptPath, err), Duration: time.Since(started)}
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

		output.WriteLine(line)
	}
	// A scan error here (e.g. the process died mid-line) isn't itself
	// fatal to reporting a result — cmd.Wait() below still returns the
	// process's real exit error, which is what actually determines
	// Success; losing the last partial line of output is an acceptable
	// trade for not needing a second error path here.
	_ = scanner.Err()

	err = cmd.Wait()
	duration := time.Since(started)

	if runCtx.Err() != nil {
		return Result{
			Success:  false,
			Output:   output.String() + fmt.Sprintf("\n\n[autodeploy] killed after exceeding %s timeout", timeout),
			Duration: duration,
		}
	}

	return Result{
		Success:  err == nil,
		Output:   output.String(),
		Duration: duration,
	}
}
