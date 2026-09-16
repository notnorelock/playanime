# Copilot instructions

Read `/AGENTS.md` in the repo root before generating or suggesting code — it
is the canonical instruction file for every AI agent working in this
repository (architecture, package-tier import boundaries, backend/frontend
conventions, and environment-specific gotchas).

Key points Copilot in particular should keep in mind while completing code
inline in this repo:

- **Package tiers are enforced by ESLint**, not just convention
  (`packages/eslint-config/boundaries.js`). A suggested import that crosses
  tiers backward (e.g. `packages/database` importing from `packages/api`)
  will fail lint even if it typechecks.
- **Every wire shape lives in `packages/contracts`** as a TypeBox schema.
  Don't suggest a hand-written duplicate interface for a request/response
  body — import the `Static<typeof X>` type instead.
- **Cursor pagination only.** Never suggest `offset`/`page` query params on a
  list endpoint.
- **Never suggest a hard `DELETE`** on catalogue tables (anime, episodes) or
  anything with a `deletedAt` column — use the soft-delete filter pattern
  already present in the surrounding repository file.
- **Redis keys go through `redisKeys.*`** in `packages/redis/src/keys.ts`.
  Don't suggest a raw template-string key.

See `/AGENTS.md` for the full architecture description, conventions list, and
verification checklist.
