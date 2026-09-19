# Byse

The [documented iframe player](https://byse.sx/api-docs)
(`GET https://api.byse.sx/e/{file_code}`) is the baseline and the guaranteed
fallback: it needs no configuration and always works.

When `ByseProviderOptions.nativePlayback` is explicitly configured, real
source/track URLs are resolved instead, through Byse's own (undocumented)
video-details API on the resolved embed domain — Byse's operator
specifically authorized this integration to use it. This is off by default,
and every failure at any step (domain resolution, decrypt, an unmet captcha
requirement) falls straight back to the iframe. See `ByseVideoApi`,
`ByseResolver.nativePlayback`, `BysePlaybackCrypto`, `BysePow`, and
`ByseAttestation`.

## Identity

Stable source identity is `provider: "byse"` + `fileCode`. Both documented
URL shapes normalize to it:

- `https://{host}/e/{fileCode}`
- `https://{host}/download/{fileCode}[/{slug}]` — the slug is display
  provenance only, never identity.

`{host}` is any domain whose registrable label starts with `byse`
(`ByseUrls.isByseSourceHost`), matching how Byse actually mirrors its source
pages — not one fixed domain.

## Embed host trust

The *embed* host is a separate question from the *source* host above, because
`GET /get/domain` can return a domain with no "byse" prefix at all. The only
hosts ever framed are the compiled-in documented default
(`api.byse.sx`) and whatever `ByseResolver` itself learned from that
key-gated call — tracked in `ByseEmbedHostAllowlist`, never derived from a
submitted or stored URL. See `ProviderDefinition.isEmbedUrlAllowed`.

## Optional API-key enhancements

Everything below requires `BYSE_API_KEY` and degrades safely without one —
basic iframe playback, the URL parser, progress, and the AnimeWatch importer
all work with no key configured.

- `GET /get/domain` — resolves the current embed domain, cached in Redis
  (`ByseResolver.resolveEmbedDomain`).
- `GET /file/info` — source-level health/metadata, used to mark a source
  `canplay: 0` as unavailable rather than handing the viewer a broken embed
  (`ByseResolver.fileInfo`). Never treated as anime/episode metadata —
  AniList/PlayAnime stay the source of truth for that.

`GET /hls/link` (Premium Bandwidth) is out of scope. It is not implemented
and not faked.

## Native playback

Off by default (`BYSE_NATIVE_PLAYBACK_ENABLED`). When enabled:

- `ByseVideoApi` calls `GET/POST /api/videos/{fileCode}/embed/{details,settings,playback}`
  on the *resolved embed domain* (never a fixed/configured origin), sending
  the same `X-Embed-Origin`/`X-Embed-Referer` context the documented iframe
  itself would.
- `BysePlaybackCrypto.decryptBysePlayback` AES-GCM-decrypts the returned
  envelope, picking the two key parts the envelope's own `version` field
  selects.
- `BYSE_AUTO_SOLVE_POW_CAPTCHA` additionally solves Byse's proof-of-work
  player check (`BysePow.solveBysePow`, a CPU-bound port of the client's own
  hash routine — no browser APIs) when `settings.captchaRequired` and the
  unauthenticated playback request fails.
- `BYSE_ATTEST_DEVICE` additionally performs Byse's device-attestation
  handshake (`ByseAttestation` — ECDSA P-256 signing + a node-canvas
  fingerprint of *this server's* rendering stack, not a real browser's) once
  per deployment, caching the resulting fingerprint rather than re-attesting
  per call.

Every step degrades to `undefined` (never throws past `ByseResolver`) on any
failure, so `ByseProvider.resolvePlayback` always has the iframe descriptor
to fall back to.

## Progress

Progress is obtained from the documented `byse-progress` `postMessage`
event, not from anything resolved server-side. `@playanime/player`'s
`ByseProgressBridge` validates every message (origin, `file_code`, and every
numeric field finite) before forwarding it into PlayAnime's normal
`timeUpdate`/`paused` playback events — the same path native `<video>`
playback uses, so watch-progress persistence, throttling and the save
endpoint are unchanged for this provider.

## Subtitles, poster, logo

`ByseEmbed.buildByseEmbedPlayerUrl` builds the documented `cX_file`/`cX_label`
subtitle pairs, `poster`, and `logo` query parameters via `URL`/
`URLSearchParams` — never string concatenation. All three are optional
presentation enhancements; their absence must never affect playback.

Poster and logo are wired end-to-end (`PlaybackContext.posterUrl`,
`BYSE_EMBED_LOGO_URL`). The *iframe* embed builder itself has no multi-track
subtitle call site — PlayAnime's `EpisodeSource` model represents one
subtitle *language* per source row there, not a multi-track list. Native
playback's own decrypted `tracks[]` is a separate path and is wired: it
becomes `NativePlayback.tracks` (`PlaybackTrack[]`) directly, which is how a
Byse video's real multi-track subtitles reach the player when native
playback is enabled.
