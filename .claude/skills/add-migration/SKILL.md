---
name: add-migration
description: Change the PlayAnime Postgres schema safely — edit Drizzle schema, generate a migration, review the SQL, apply it, and verify against the live database. Use whenever a task requires adding, removing, or altering a column, table, index, or enum in packages/database/src/schema/.
---

# Adding a schema migration

This is the ordering that avoids the two mistakes that actually happen in
this repo: applying a migration you didn't review, and forgetting that
`drizzle-kit` doesn't load `.env` on its own from inside `packages/database`.

## Steps

1. **Edit the schema file** under `packages/database/src/schema/*.ts`. Match
   the existing column-builder conventions in that file (`primaryId()`,
   `fk()`, `timestamps()`, etc. from `_shared.ts` — don't hand-roll a column
   definition style that already has a helper).

2. **Generate the migration.** Run from `packages/database/`, with
   `DATABASE_URL` passed inline since the config reads `process.env` directly
   with no dotenv loading of its own:

   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/playanime bun run generate
   ```

   (Or from the repo root: `bun run db:generate`, if that script already
   handles env loading in this checkout — check `package.json` first.)

3. **Read the generated SQL file** in `packages/database/src/migrations/`
   before doing anything else. Confirm it contains *only* the change you
   intended — one `ALTER TABLE ADD/DROP COLUMN`, not a rename Drizzle
   misread as a drop-and-add, not an unrelated column getting touched. If
   the diff looks wrong, fix the schema file and regenerate rather than
   hand-editing the SQL.

4. **Apply it:**

   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/playanime bun run migrate
   ```

5. **Verify against the live database directly** — don't trust "migrations
   applied" as proof of correctness:

   ```
   docker exec <postgres-container> psql -U postgres -d playanime -c "\d <table>"
   ```

   Confirm the column/table/index looks exactly as intended, and — if the
   change is destructive (a drop) — that existing data in unrelated columns
   on the same table survived.

6. **Update every consumer.** A dropped or renamed column breaks: repository
   `.select()`/`.insert()`/`.update()` calls referencing it, the row types
   those repositories export, API mappers that forward the field into a DTO,
   the contract schema in `packages/contracts` if it's part of a public
   shape, and frontend components/models that read it. Run
   `bun run typecheck` from the repo root after the schema edit — it will
   surface most of these as compile errors across every tier. Grep for the
   old field name too; a locally-defined interface in the frontend (e.g. an
   API-client-side type) can go stale without ever showing up as a
   typecheck error if nothing in that file actually destructures the
   missing field strictly.

7. **Historical migration files and their `meta/*_snapshot.json` siblings are
   append-only.** Never edit a past migration to "fix" it retroactively —
   that desyncs the migration chain from what's actually been applied to any
   already-migrated database. Only the newest migration you just generated
   is yours to review before applying.

## Final check

Run the full verification suite from the repo root:

```
bun run typecheck
bun test
bun run lint
```

Compare the lint error count/file list against the known pre-existing
baseline (documented in `AGENTS.md`) — don't chase baseline errors, but any
*new* error in a file you touched is yours to fix.
