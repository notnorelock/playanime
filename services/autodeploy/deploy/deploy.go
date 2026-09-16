// Package deploy runs the repo's own deploy.sh and captures its result.
package deploy

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"time"
)

type Result struct {
	Success  bool
	Output   string
	Duration time.Duration
}

// Run executes scriptPath (relative to repoPath) with bash, piping "y\n"
// to stdin so deploy.sh's own behind-remote-check confirmation prompt
// (see infrastructure/docker/deploy.sh) can never hang this indefinitely —
// autodeploy always deploys immediately after a fresh pull, so that
// checkout is never behind by the time this runs, but answering "y"
// automatically closes off the one way a race there could otherwise wedge
// this goroutine.
func Run(ctx context.Context, repoPath, scriptPath string, timeout time.Duration) Result {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()

	cmd := exec.CommandContext(runCtx, "bash", filepath.Join(repoPath, scriptPath))
	cmd.Dir = repoPath
	cmd.Stdin = bytes.NewBufferString("y\n")

	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output

	err := cmd.Run()
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
