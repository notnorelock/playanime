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

## Adding a provider

1. Confirm the provider publishes an integration PlayAnime is allowed to use.
2. Add the id to `MediaProviderId` in `@playanime/contracts`.
3. Implement `ExternalMediaProvider`.
4. Register it in `src/registry/default-registry.ts`.
5. Add parsing and resolution tests.
