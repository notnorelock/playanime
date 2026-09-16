---
name: restart-dev-server
description: Cleanly restart the PlayAnime API or web dev server on Windows, avoiding the stale-duplicate-process bug this repo hits repeatedly. Only use this when the user has explicitly asked for a server restart, or explicitly told you to manage dev servers yourself for the session — never proactively.
---

# Restarting a dev server without leaving a stale duplicate

**Do not run this unprompted.** The user runs their own API/web dev servers
in this project and has stated more than once that they don't want them
restarted, killed, or started without being asked first. If a fix needs a
restart to take effect and nobody's asked you to do one, say so and let the
user do it — verify what you can against the server that's already running
instead (`curl`, a direct DB/Redis query).

Use this skill only when the user has actually asked for a restart.

## Why this needs care on this machine

Windows doesn't set `SO_EXCLUSIVEADDRUSE` here, so a second process can bind
a port that's already listening without erroring. A naive restart —
Ctrl+C-equivalent on one terminal, then starting a new process — can leave
the *old* process still running and still answering requests, invisibly,
while you test against what you think is the new one. This has produced
"why isn't my fix showing up" confusion multiple times in this project.
Always find and kill every PID on the port first.

## Steps

1. **Find every process on the port** (4000 for the API, 3000 for web):

   ```
   netstat -ano | grep ":4000" | grep LISTENING
   ```

   If more than one PID shows up, all of them are stale — kill all of them,
   not just one.

2. **Kill each PID found:**

   ```
   taskkill //F //PID <pid>
   ```

3. **Confirm the port is actually clear** before starting anything new:

   ```
   netstat -ano | grep ":4000" | grep LISTENING || echo "port clear"
   ```

4. **Start the server.** From the repo root for the API:

   ```
   bun run --filter '@playanime/api' dev
   ```

   For web:

   ```
   bun run --filter '@playanime/web' dev
   ```

   (Root `bun run dev` only starts the API — see `AGENTS.md`.)

5. **Re-check the port immediately after starting** — if two PIDs appear
   again (this has happened even right after a clean start in this repo,
   apparently from a wrapper process spawning a child that also binds the
   port), kill both and restart once more rather than proceeding with an
   ambiguous state.

6. If you started it in the background specifically to verify a fix, tell
   the user it's running and offer to leave it up or stop it — don't leave a
   server running in the background across turns without saying so.
