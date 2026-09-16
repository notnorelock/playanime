---
name: add-api-endpoint
description: Add a new PlayAnime API endpoint end-to-end — contract schema, repository query, service function, controller route, and the frontend API client method that calls it. Use whenever a task requires a new backend route or a new operation on existing data.
---

# Adding an API endpoint end-to-end

This repo is contracts-first: the shape is defined once and both sides import
it. Build in this order — each layer depends on the one before it existing.

## Steps

1. **Define or extend the contract** in
   `packages/contracts/src/<domain>/index.ts`. A request body, a response
   shape, and a query type are each their own `Type.Object(...)` with an
   exported `Static<typeof X>` type. If the response is a paginated list,
   use `CursorPageOf(ItemType)` from `../common/index.js` — never build a
   custom `{ items, total, page }` shape.

   - Look at a neighboring contract in the same file for the field-naming and
     nullability conventions already in use (e.g. `Type.Union([T, Type.Null()])`
     for a nullable field, not `Type.Optional` unless the field is genuinely
     absent-vs-present rather than present-but-null).

2. **Write the repository method** in
   `packages/database/src/repositories/<domain>.repository.ts`. Query only —
   no authorization checks, no business rules. Select fields explicitly (not
   `select()` with no arguments); reuse an existing `xSelection` object in
   the same file if the join already exists elsewhere for a similar query.
   Export the inferred row type at the bottom of the file
   (`export type XRow = Awaited<ReturnType<XRepository['method']>>[...]`) if
   a mapper elsewhere will need it.

3. **Write the service function** in
   `packages/api/src/modules/<domain>/<domain>.service.ts`. This is where
   authorization lives — check ownership, role, group membership, whatever
   the endpoint requires, and throw the appropriate `AppError` subclass from
   `@playanime/shared` (`NotFoundError`, `AuthorizationError`,
   `ConflictError`, etc.) rather than a generic `Error`. Map the repository's
   row to the contract's response shape via the domain's `<domain>.mapper.ts`
   — every field assigned explicitly, never a raw spread of the row.

4. **Wire the controller route** in
   `packages/api/src/modules/<domain>/<domain>.controller.ts`. Keep it thin:
   parse `params`/`query`/`body` against the contract schema (Elysia's `t.*`
   or the imported TypeBox schema directly), call the service function, return
   its result. Auth-gate with `requireAuth(session)` or
   `requireVerifiedEmail(session)` from `@playanime/auth` if the route needs
   a signed-in caller. Add a `detail: { summary, description, tags }` block —
   every existing route has one, and it's what documents the API.

   - If this is a genuinely new route file (not adding to an existing
     controller), register it in `packages/api/src/routes/v1.ts`'s `.use()`
     chain.

5. **Add the frontend API client method** in
   `packages/web/src/api/<domain>.ts`. One `http.get/post/put/delete` call,
   typed against the same contract types imported from `@playanime/contracts`
   — never redeclare the shape. Follow the existing signature pattern in that
   file (optional `signal?: AbortSignal` as the last parameter for GET
   requests, a `query: XQuery = {}` default for list endpoints).

6. **Consume it from a component or composable**, not directly from a
   `<script setup>` one-off `fetch`. If several sibling components need the
   same data on one page, check whether a module-level singleton composable
   (like `useCataloguePermissions.ts`) is the right pattern to avoid redundant
   calls, rather than each component fetching independently.

## Verification

- `bun run typecheck` from the repo root — this is the main safety net here;
  a contract change that breaks a consumer shows up as a compile error in
  that consumer's file, across every tier, in one pass.
- Hit the live endpoint directly if the stack is running (`curl` with the
  right method/body), rather than only trusting that it typechecks. Check
  the actual response shape matches the contract, not just that the route
  responds with 200.
- `bun test` and `bun run lint` — see `AGENTS.md` for the pre-existing lint
  baseline to compare against.
