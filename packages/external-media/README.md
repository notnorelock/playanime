# @playanime/external-media

Provider detection, URL parsing, normalization, and playback resolution for
**third-party** video sources.

PlayAnime is an anime database and community platform. It does not host,
upload, transcode, mirror, proxy, cache, or serve video files. Every playable
source is a link to a provider that hosts the content itself.

## What this package must never do

These are architectural constraints, not style preferences. A change that adds
any of the following should be rejected in review:

- Extract, scrape, or reconstruct a direct media URL from a provider page.
- Read, derive, or replay a playback token, signed URL, or expiring link.
- Circumvent DRM, authentication, ACLs, resource keys, download quotas,
  hotlink protection, or geographic restrictions.
- Fetch video bytes for any reason, including availability checks and
  thumbnailing.
- Route third-party video through a PlayAnime server.

There is no HTTP client in this package's dependencies. Provider logic is pure
URL parsing plus construction of documented embed URLs. The only network access
in the whole feature is the optional Google Drive **metadata** call in the API
layer, which uses Google's official API with the caller's own key.

## The `native` safeguard

`PlaybackDescriptor` has a `native` branch for direct `<video>` playback. A
provider may only emit it when `definition.canEmitNative` is `true`, and
`assertDescriptorIsLegal()` throws otherwise.

Every third-party host provider declares `canEmitNative: false`. That makes
"just extract the mp4" impossible to add incrementally — you would have to flip
a flag whose comment explains precisely why you may not. That is the intent: the
prohibition lives in the type system, not in a contributor's memory.

## Embed policy

A provider may render in an iframe only with `embedPolicy: EMBED`, which
requires a **documented, publicly supported** embed mechanism. Providers whose
integration has not been verified are `LINK_ONLY` and resolve to
`type: "external"` — the viewer opens the provider's own page.

`LINK_ONLY` is a correct outcome, not a gap to engineer around. A provider that
has not offered embedding has not consented to being framed.

### Current provider status

| Provider      | Policy      | Mechanism                                            |
| ------------- | ----------- | ---------------------------------------------------- |
| YouTube       | `EMBED`     | Documented IFrame Player API, `youtube-nocookie.com` |
| Google Drive  | `EMBED`     | Documented `/file/d/{id}/preview` for viewable files  |
| CDA           | `LINK_ONLY` | Embed mechanism not yet verified — see provider file  |
| Vidoza        | `LINK_ONLY` | Embed mechanism not yet verified                      |
| MP4Upload     | `LINK_ONLY` | Embed mechanism not yet verified                      |
| Sibnet        | `LINK_ONLY` | Embed mechanism not yet verified                      |
| External link | `LINK_ONLY` | Off-site link only                                    |

The four `LINK_ONLY` hosts parse and normalize their URLs correctly — they are
real providers, not stubs — but do not embed. Promoting one to `EMBED` requires
citing its published embed documentation and terms in the provider file.

## Adding a provider

1. Confirm the provider publishes an embed mechanism and that its terms permit
   this use. Cite both in the provider file.
2. Add the id to `MediaProviderId` in `@playanime/contracts`. That enum is the
   platform allowlist; nothing outside it can ever be embedded.
3. Implement `ExternalMediaProvider` with pure parsing. No network calls.
4. Register it in `src/registry/default-registry.ts`.
5. Add parsing tests, including malformed and look-alike hostnames.
