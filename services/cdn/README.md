# PlayAnime CDN

A minimal, read-only static file server for user-uploaded media (avatars
today). Runs as its own container, behind `cdn.playani.me`.

## Why a separate service

The API (`packages/api`) is the only thing that ever writes into the shared
volume this serves from — it owns auth, validates uploads (size, type), and
decides the final file path (a random filename, never the user's own). This
service never sees a session cookie or touches the database; it only serves
files the API already wrote and approved. That split is what makes it safe
to expose on its own subdomain with no auth of its own.

## Local development

```
go run .
```

Defaults to serving `./data` on `:3100`. Override with `CDN_ROOT` and
`PORT` env vars — see `docker-compose.yml` for the values used there.

## Production

Built and run via `infrastructure/docker/Dockerfile.cdn`, wired up in
`docker-compose.yml` (base) and `docker-compose.prod.yml` (Caddy routing +
the shared volume with the `api` container). See `infrastructure/docker/
Caddyfile` for the `cdn.playani.me` block.
