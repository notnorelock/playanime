---
name: add-locale-string
description: Add or edit a user-facing string in PlayAnime's Polish/English locale files without breaking the pair. Use whenever a UI change needs new copy, not just when explicitly asked to "add a translation."
---

# Adding a locale string

`packages/web/src/locales/en.json` and `pl.json` are structurally identical —
same nesting, same key order, same line count. A component reads strings via
`t('section.key')` from `useLocale()`; a key that exists in one file and not
the other doesn't error at compile time, it just renders the raw key path or
falls back silently depending on the i18n setup, which is a much harder bug
to notice than a missing import.

## Steps

1. **Find the right section**, not just any spot. Both files are organized
   by feature/domain (`auth`, `profile`, `catalogue`, `library`, `common`,
   ...) — the same top-level key appears more than once in these files for
   different contexts (e.g. `cancel` exists at multiple nesting depths), so
   grep for the *specific* nearby key you expect to sit next to
   (`grep -n '"auth.twoFactor"' packages/web/src/locales/en.json`) rather
   than the bare word, to land in the right subsection.

2. **Add the key to `en.json` first**, in English, placed next to the most
   related existing key in that section (not alphabetized — this repo's
   locale files are organized by logical grouping, not alphabetically).

3. **Add the identical key to `pl.json`** at the same nesting position,
   translated to Polish. Match the tone of neighboring Polish strings in that
   section (this app is Polish-primary — see `pickTitle()`'s doc comment in
   `packages/web/src/models/anime.ts` for why locale defaults favor Polish).

4. **Use `{placeholder}` interpolation consistently** if the string needs a
   dynamic value — both files must use the exact same placeholder name
   (`{count}`, `{status}`, etc.), since the calling code passes a single
   params object shared across locales:
   `t('profile.activity.rating', { score: item.score })`.

5. **Call it from the component** with `useLocale()`'s `t()`, never a
   hardcoded string, even for something that feels like it'll never need
   translating (a button label, an aria attribute, a toast message).

## Verification

- After editing, both files should still have the same line count as a quick
  sanity check that no section was accidentally duplicated or a brace
  mismatched: `wc -l packages/web/src/locales/en.json packages/web/src/locales/pl.json`.
  They won't always match exactly (a key's value can wrap or not depending on
  language), but a large divergence is a signal something's wrong.
- `bun run --filter '@playanime/web' typecheck` — this repo's locale files
  are also validated as regular JSON by the build; a syntax error (trailing
  comma, mismatched brace) fails the build immediately.
- Grep both files for the new key to confirm it exists in exactly one place
  in each, not accidentally added twice in two different sections.
