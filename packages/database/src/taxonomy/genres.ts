/**
 * The curated, fixed genre catalogue.
 *
 * Single source of truth for both the dev seed and `ensureCoreTaxonomy`
 * (run once at API startup — see `bootstrap/ensure-taxonomy.ts`). Genres
 * are a small, deliberately curated list, unlike tags, which exist
 * specifically to receive AniList's much larger free-form set and are
 * created on demand instead (see `packages/importer/src/taxonomy.ts`'s
 * `resolveOrCreateTaxonomy`).
 *
 * `name` matches AniList's own `GenreCollection` values exactly (all 19 of
 * them, confirmed live against `query { GenreCollection }`) — that's what
 * `resolveKnownTaxonomy` matches AniList genre names against, so a name
 * that doesn't match exactly is a genre that silently never gets attached
 * to a synced title, the same bug this whole list exists to avoid.
 *
 * `isMature` gates `Ecchi` and `Hentai` out of `/genres` and autofill for
 * a viewer who hasn't opted into mature content — same column, same
 * filter, every other genre already relies on for everything else.
 */
export const CORE_GENRES = [
  { slug: 'akcja', name: 'Action', namePolish: 'Akcja' },
  { slug: 'przygodowe', name: 'Adventure', namePolish: 'Przygodowe' },
  { slug: 'komedia', name: 'Comedy', namePolish: 'Komedia' },
  { slug: 'dramat', name: 'Drama', namePolish: 'Dramat' },
  { slug: 'ecchi', name: 'Ecchi', namePolish: 'Ecchi', isMature: true },
  { slug: 'fantasy', name: 'Fantasy', namePolish: 'Fantasy' },
  { slug: 'hentai', name: 'Hentai', namePolish: 'Hentai', isMature: true },
  { slug: 'horror', name: 'Horror', namePolish: 'Horror' },
  { slug: 'magiczne-dziewczyny', name: 'Mahou Shoujo', namePolish: 'Magiczne Dziewczyny' },
  { slug: 'mecha', name: 'Mecha', namePolish: 'Mecha' },
  { slug: 'muzyka', name: 'Music', namePolish: 'Muzyka' },
  { slug: 'detektywistyczne', name: 'Mystery', namePolish: 'Detektywistyczne' },
  { slug: 'psychologiczne', name: 'Psychological', namePolish: 'Psychologiczne' },
  { slug: 'romans', name: 'Romance', namePolish: 'Romans' },
  { slug: 'sci-fi', name: 'Sci-Fi', namePolish: 'Sci-Fi' },
  { slug: 'okruchy-zycia', name: 'Slice of Life', namePolish: 'Okruchy życia' },
  { slug: 'sport', name: 'Sports', namePolish: 'Sport' },
  { slug: 'nadprzyrodzone', name: 'Supernatural', namePolish: 'Nadprzyrodzone' },
  { slug: 'thriller', name: 'Thriller', namePolish: 'Thriller' },
] as const;
