# @playanime/shared

Tier-0 package. **Zero runtime dependencies** — not even a validation library.

## Charter

`shared` exists to hold primitives that genuinely cross package boundaries. It is
deliberately narrow, because a package named "shared" is the single most common
place for a codebase to accumulate unrelated junk.

### What belongs here

- The application error model (`AppError` and its subclasses).
- `Result` and typed-outcome helpers.
- Branded ID types and ID generation.
- Cross-tier pure primitives: pagination math, slugify, duration/time helpers.

### What does NOT belong here

- Anything importing a framework (Elysia, Solid, Drizzle, ioredis, …).
- Anything domain-specific to a single consumer. Anime logic lives in the module
  that owns anime; playback logic lives in `@playanime/player`.
- Anything with a single call site. One call site means it belongs at that site.
- Wire/DTO shapes. Those live in `@playanime/contracts`.
- Environment access. `process.env` is read only by `@playanime/config`.

## The admission rule

> A symbol earns a place in `shared` when **three or more packages, across two or
> more tiers, need it**. Until then it lives with its consumer.

When reviewing a PR that adds to this package, ask for the three call sites. If
they do not exist, the change belongs elsewhere. Moving code *out* of `shared`
later is cheap; untangling a dumping ground is not.
