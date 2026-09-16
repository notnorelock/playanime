# CLAUDE.md

Claude Code-specific notes for this repository. **Read `AGENTS.md` first** —
it's the canonical instruction file (architecture, conventions, verification
checklist, known gotchas) and applies to every agent working here, Claude
Code included. This file only adds what's specific to this tool.

## Skills available in this repo

See `.claude/skills/` — invoke with `/skill-name`. Use them for the workflow
they cover rather than reinventing the steps; each encodes an ordering
that's easy to get subtly wrong by hand.

- `/add-migration` — schema change → generate → review the SQL → apply →
  verify against the live database.
- `/add-api-endpoint` — contract → repository → service → controller →
  frontend client, in that order.
- `/add-vue-feature-component` — matches this repo's loading/error/empty
  state shape and AbortController fetch pattern.
- `/design-frontend-ui` — the actual verified design system: color tokens,
  glassmorphism tiers and the nested-blur pitfall, component variants,
  spacing/typography/icon conventions. Read before any UI work, not only
  when explicitly asked to design something.
- `/add-locale-string` — keeps `en.json`/`pl.json` in sync; a key present in
  one and not the other fails silently, not at compile time.
- `/verify-against-live-stack` — the `docker exec`/`curl`/`redis-cli`
  commands actually used to confirm a fix in this project, plus the
  test-data cleanup discipline.
- `/restart-dev-server` — **only when the user has explicitly asked for a
  restart.** Encodes the exact sequence that avoids this project's stale-
  duplicate-process bug on Windows.
- `/add-privileged-action` — a moderator/admin action with correct
  authorization (platform role vs. translator-group role — see
  `two-authorization-models` memory) and the required audit-log write.
- `/add-redis-backed-flow` — short-lived multi-step server state (OAuth
  state, a login challenge, a pending confirmation), matching the pattern
  already used for Discord OAuth and 2FA.

## Auto memory

This project has accumulated session memory under
`.claude/projects/**/memory/` (path varies by machine — it's keyed to the
absolute repo path). If you're picking up a fresh session on this repo,
that memory holds feedback the user has already given about *how* to work
here — re-litigating a preference they already stated once is exactly what
the memory system exists to prevent. Check it before assuming.

## Working with this user on this repo

- **Never restart, kill, or start dev servers without being asked.** This has
  been stated explicitly more than once in this project — the user runs
  their own API/web dev servers and wants control over when they cycle. If a
  fix needs a server restart to take effect and you can't ask first, say so
  and let the user do it, rather than doing it yourself. (Verifying a fix via
  `curl` against an already-running server the user started is fine;
  spawning or killing that process is not.)
- **Files change out from under you.** The user actively edits files in the
  editor while a session is running — a note like "this file changed on disk
  since you last read it" means exactly that, not a bug. Re-read before
  editing, treat a mid-edit or malformed state (e.g. a truncated Tailwind
  class) as something to fix, and treat a deliberate-looking change as the
  user's call, not something to revert silently.
- **When a bug report turns out to reveal a second bug, say so and fix both.**
  This has happened repeatedly in this project (a UI symptom traced back to
  a data-model bug one layer deeper; a "token invalid" report that turned out
  to be two independent causes stacked). Don't stop at the first plausible
  fix if verifying it surfaces something else wrong.
- **Verify fixes against the live stack when one is available**, not just
  `bun run typecheck`. This project has a running Postgres/Redis/API/web
  stack for most of its sessions; a bug fix is confirmed by curling the
  actual endpoint or checking the actual row, not merely by the type-checker
  going quiet.

## Full project memory

See `MEMORY.md` in this directory for the indexed, topic-organized record of
project context, user preferences, and durable decisions carried across
sessions. That file is the index; the linked files under it hold the actual
content.
