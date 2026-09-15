# @playanime/contracts

The wire format between `@playanime/api` and `@playanime/web`. One definition,
consumed by both sides.

## Why TypeBox rather than Zod

Elysia validates requests with TypeBox natively. Defining contracts in TypeBox
means a single schema object serves three purposes at once:

1. **Runtime validation** at the API edge — Elysia compiles it to a fast
   validator and rejects malformed input before a handler runs.
2. **Static types** on both sides, via `Static<typeof Schema>`.
3. **OpenAPI generation**, because TypeBox *is* JSON Schema.

Defining them in Zod instead would mean either duplicating every schema or
converting between the two at runtime. The brief explicitly asked not to
duplicate schemas when Elysia's type system can provide them cleanly.

Zod remains the right tool for validation *inside* a package that is not an
Elysia route — `@playanime/config` uses it for environment parsing, where no
OpenAPI or Elysia integration is involved.

## The hard rule

**Database models must never be re-exported from this package.** A Drizzle row
type describes storage; a contract describes what the public API promises. They
drift deliberately — a row has `passwordHash`, `internalNotes`, and a soft-delete
flag that no client may ever see.

Mapping from row to contract happens in the API module that owns the resource,
in an explicit `toPublicX()` function. That function is the only place the two
representations meet, which makes leaking a column an obvious review error
rather than an invisible one.

This is enforced by lint: `contracts` sits at tier 1 and cannot import
`@playanime/database` at all.
