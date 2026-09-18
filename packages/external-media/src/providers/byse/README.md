# Byse

Byse integration intentionally uses the [documented iframe player](https://byse.sx/api-docs)
(`GET https://api.byse.sx/e/{file_code}`). Native HLS resolution is not
required or implemented — Byse does not document a native playback surface,
and the embed already gives every viewer a working player without depending
on undocumented internals.

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
`BYSE_EMBED_LOGO_URL`). Subtitles are not currently called from
`ByseProvider` — PlayAnime's `EpisodeSource` model represents one subtitle
*language* per source row, not a multi-track list, so there is nothing to
pass in yet. The builder itself is complete and tested; wiring a real
multi-track subtitle source is future work, not a gap in this integration.
