# @playanime/external-media

Provider detection, URL parsing, normalization, and playback resolution for
**third-party** video sources.

PlayAnime is an anime database and community platform. It does not host,
upload, transcode, mirror, or serve video files. Every playable source is a
link to a provider that hosts the content itself. The API resolves *metadata*
only; the browser streams directly from the provider.

## Hard rules

- Do not download or proxy video bytes through PlayAnime.
- Do not decrypt DRM, forge signatures, or bypass ACLs / resource keys.
- Do not persist signed `videoplayback` URLs in PostgreSQL.
- Do not log complete signed playback URLs.

## Google Drive

Google Drive is an `EMBED` provider that may also emit `native` descriptors.

Flow:

```text
stable fileId (+ optional resourceKey)
        ↓
Drive web-player playback surfaces
        ↓
temporary progressive variants
        ↓
Redis cache (TTL before Google expiry)
        ↓
PlayAnime native player
        ↓
/preview iframe fallback
```

Resolution consults the same surfaces Drive's own web player uses:

1. `content-workspacevideo-pa.googleapis.com/.../playback`
2. legacy `get_video_info`
3. documented `fmt_stream_map` fields in the preview page

If the file is inaccessible to the current viewer, the provider returns an
access error. If variants cannot be resolved, the documented `/preview` iframe
is used.

## The `native` safeguard

`PlaybackDescriptor` has a `native` branch for direct `<video>` playback.
A provider may only emit it when `definition.canEmitNative` is `true`, and
`assertDescriptorIsLegal()` re-checks every media host against the provider's
declared `mediaHosts`.

## CDA.pl

Manual resolution without a database or running API:

```sh
bun run packages/external-media/scripts/resolve-cda.ts https://www.cda.pl/video/12244203b8
bun run packages/external-media/scripts/resolve-cda.ts 12244203b8
```

The helper prints the validated playback descriptor and temporary stream URLs.
Each invocation resolves fresh player data; failures exit with a nonzero status.

CDA uses the same registry, playback descriptors, and short-lived cache as the
other providers. URL parsing accepts `/video/{id}` on `cda.pl` or `www.cda.pl`,
plus the existing `ebd.cda.pl/{width}x{height}/{id}` input form. Internal resolver
calls also accept raw IDs. Only the canonical page URL and ID are persisted.

Resolution fetches the public page and uses `parse5` to read and HTML-decode its
`player_data` attribute. Each dynamically advertised quality is requested from
`/video/{id}/vjs` using `videoGetLink(id, quality, video.ts, video.hash2, {})`.
The token is passed unchanged. Requests run four at a time; a failed optional
quality is logged without its tokens or response body, while successful sources
and the player's direct URL remain available.

HLS uses the existing HLS adapter, with optional separate playlist sources for
manual quality selection. MP4 uses native playback. DASH is recognized internally
but opens the CDA page because PlayAnime has no DASH adapter. Cast-only manifests
are excluded. Unknown URL formats are not guessed. No iframe is constructed.

CDA assigns CDN hosts dynamically, so its provider validates public HTTPS URLs
from the trusted player response instead of fixing a stream host in code. The
server fetches only the canonical CDA page and its RPC endpoint; it never fetches
media URLs. Other providers retain their existing host allowlists.

Descriptors are cached for at most 60 seconds and expire within two minutes or
earlier if a stream's `expire`/`expires` query parameter indicates it. The existing
playback endpoint's `refresh=1` option invalidates the cache and fetches fresh
player data. Resolved MP4/DASH/HLS URLs never enter stored source metadata.

The current context is anonymous: no CDA account, PlayAnime credentials, or
viewer cookies are forwarded. The RPC carries the CDA page Referer. Browser
playback must be allowed directly by CDA; the repository has no media proxy or
mechanism for overriding the browser's Referer. Streams requiring that context
cannot be made playable by this integration. Fixture tests do not contact CDA.

## Adding a provider

1. Confirm the provider publishes an integration PlayAnime is allowed to use.
2. Add the id to `MediaProviderId` in `@playanime/contracts`.
3. Implement `ExternalMediaProvider`.
4. Register it in `src/registry/default-registry.ts`.
5. Add parsing and resolution tests.
