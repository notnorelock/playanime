import { sql } from 'drizzle-orm';
import { slugify } from '@playanime/shared';
import { createDatabase } from '../client/index.js';
import {
  entries,
  entryGenres,
  entryOrganizations,
  episodes,
  franchises,
  genres,
  mediaAssets,
  organizations,
  series,
} from '../schema/anime.js';
import { CORE_GENRES } from '../taxonomy/genres.js';

/**
 * Development seed.
 *
 * Provides enough real structure to exercise the catalogue: a multi-season
 * franchise, a film, and a split-cour series, so pagination, filtering and the
 * franchise/season/episode hierarchy can all be checked against something other
 * than a single flat row.
 *
 * Idempotent — safe to run repeatedly against a development database.
 */

const STUDIOS = [
  'MAPPA',
  'Wit Studio',
  'ufotable',
  'Kyoto Animation',
  'Madhouse',
  'Bones',
  'Production I.G',
  'Studio Ghibli',
];

interface SeedTitle {
  readonly titleRomaji: string;
  readonly titleEnglish: string | null;
  readonly titleNative: string | null;
  readonly format: 'tv' | 'movie' | 'ova' | 'ona' | 'special' | 'tv_short' | 'music';
  readonly status: 'finished' | 'releasing' | 'not_yet_released' | 'hiatus' | 'cancelled';
  readonly season: 'winter' | 'spring' | 'summer' | 'fall' | null;
  readonly seasonYear: number | null;
  readonly episodeCount: number | null;
  readonly durationMinutes: number | null;
  readonly synopsis: string;
  readonly averageRating: string;
  readonly ratingCount: number;
  readonly popularityScore: number;
  readonly genreSlugs: readonly string[];
  readonly studio: string;
  readonly franchise?: string;
}

const TITLES: readonly SeedTitle[] = [
  {
    titleRomaji: 'Shingeki no Kyojin',
    titleEnglish: 'Attack on Titan',
    titleNative: '進撃の巨人',
    format: 'tv',
    status: 'finished',
    season: 'spring',
    seasonYear: 2013,
    episodeCount: 25,
    durationMinutes: 24,
    synopsis:
      'Ludzkość żyje otoczona murami, chroniąc się przed olbrzymimi Tytanami. Gdy mur zostaje przełamany, Eren Jaeger przysięga zemstę.',
    averageRating: '8.54',
    ratingCount: 1_240,
    popularityScore: 9_800,
    genreSlugs: ['akcja', 'dramat', 'fantasy'],
    studio: 'Wit Studio',
    franchise: 'Shingeki no Kyojin',
  },
  {
    titleRomaji: 'Shingeki no Kyojin: The Final Season',
    titleEnglish: 'Attack on Titan: The Final Season',
    titleNative: '進撃の巨人 The Final Season',
    format: 'tv',
    status: 'finished',
    season: 'winter',
    seasonYear: 2021,
    episodeCount: 16,
    durationMinutes: 24,
    synopsis: 'Konflikt między Eldią a Marley osiąga punkt kulminacyjny.',
    averageRating: '8.79',
    ratingCount: 980,
    popularityScore: 9_400,
    genreSlugs: ['akcja', 'dramat'],
    studio: 'MAPPA',
    franchise: 'Shingeki no Kyojin',
  },
  {
    titleRomaji: 'Kimetsu no Yaiba',
    titleEnglish: 'Demon Slayer',
    titleNative: '鬼滅の刃',
    format: 'tv',
    status: 'finished',
    season: 'spring',
    seasonYear: 2019,
    episodeCount: 26,
    durationMinutes: 24,
    synopsis:
      'Tanjiro Kamado zostaje pogromcą demonów, by odnaleźć lekarstwo dla siostry przemienionej w demona.',
    averageRating: '8.42',
    ratingCount: 1_560,
    popularityScore: 9_600,
    genreSlugs: ['akcja', 'fantasy', 'nadprzyrodzone'],
    studio: 'ufotable',
    franchise: 'Kimetsu no Yaiba',
  },
  {
    titleRomaji: 'Kimetsu no Yaiba: Mugen Ressha-hen',
    titleEnglish: 'Demon Slayer: Mugen Train',
    titleNative: '劇場版 鬼滅の刃 無限列車編',
    format: 'movie',
    status: 'finished',
    season: null,
    seasonYear: 2020,
    episodeCount: 1,
    durationMinutes: 117,
    synopsis: 'Tanjiro i jego towarzysze badają zniknięcia w tajemniczym pociągu.',
    averageRating: '8.61',
    ratingCount: 720,
    popularityScore: 8_100,
    genreSlugs: ['akcja', 'fantasy', 'nadprzyrodzone'],
    studio: 'ufotable',
    franchise: 'Kimetsu no Yaiba',
  },
  {
    titleRomaji: 'Fullmetal Alchemist: Brotherhood',
    titleEnglish: 'Fullmetal Alchemist: Brotherhood',
    titleNative: '鋼の錬金術師 FULLMETAL ALCHEMIST',
    format: 'tv',
    status: 'finished',
    season: 'spring',
    seasonYear: 2009,
    episodeCount: 64,
    durationMinutes: 24,
    synopsis:
      'Bracia Elric poszukują Kamienia Filozoficznego, by odzyskać ciała utracone w zakazanym rytuale.',
    averageRating: '9.09',
    ratingCount: 2_100,
    popularityScore: 9_900,
    genreSlugs: ['akcja', 'przygodowe', 'dramat', 'fantasy'],
    studio: 'Bones',
  },
  {
    titleRomaji: 'Steins;Gate',
    titleEnglish: 'Steins;Gate',
    titleNative: 'シュタインズ・ゲート',
    format: 'tv',
    status: 'finished',
    season: 'spring',
    seasonYear: 2011,
    episodeCount: 24,
    durationMinutes: 24,
    synopsis: 'Grupa przyjaciół odkrywa sposób na wysyłanie wiadomości w przeszłość.',
    averageRating: '9.07',
    ratingCount: 1_430,
    popularityScore: 8_900,
    genreSlugs: ['sci-fi', 'thriller', 'dramat'],
    studio: 'Madhouse',
  },
  {
    titleRomaji: 'Violet Evergarden',
    titleEnglish: 'Violet Evergarden',
    titleNative: 'ヴァイオレット・エヴァーガーデン',
    format: 'tv',
    status: 'finished',
    season: 'winter',
    seasonYear: 2018,
    episodeCount: 13,
    durationMinutes: 24,
    synopsis:
      'Były żołnierz uczy się rozumieć ludzkie emocje, pisząc listy dla innych.',
    averageRating: '8.67',
    ratingCount: 890,
    popularityScore: 7_600,
    genreSlugs: ['dramat', 'fantasy', 'okruchy-zycia'],
    studio: 'Kyoto Animation',
  },
  {
    titleRomaji: 'Jujutsu Kaisen',
    titleEnglish: 'Jujutsu Kaisen',
    titleNative: '呪術廻戦',
    format: 'tv',
    status: 'releasing',
    season: 'fall',
    seasonYear: 2020,
    episodeCount: 24,
    durationMinutes: 24,
    synopsis: 'Yuji Itadori połyka przeklęty palec i trafia do szkoły magii jujutsu.',
    averageRating: '8.58',
    ratingCount: 1_320,
    popularityScore: 9_300,
    genreSlugs: ['akcja', 'nadprzyrodzone', 'horror'],
    studio: 'MAPPA',
  },
  {
    titleRomaji: 'Haikyuu!!',
    titleEnglish: 'Haikyu!!',
    titleNative: 'ハイキュー!!',
    format: 'tv',
    status: 'finished',
    season: 'spring',
    seasonYear: 2014,
    episodeCount: 25,
    durationMinutes: 24,
    synopsis: 'Niski uczeń marzy o zostaniu gwiazdą siatkówki.',
    averageRating: '8.48',
    ratingCount: 760,
    popularityScore: 7_200,
    genreSlugs: ['sport', 'komedia', 'dramat'],
    studio: 'Production I.G',
  },
  {
    titleRomaji: 'Sen to Chihiro no Kamikakushi',
    titleEnglish: "Spirited Away",
    titleNative: '千と千尋の神隠し',
    format: 'movie',
    status: 'finished',
    season: null,
    seasonYear: 2001,
    episodeCount: 1,
    durationMinutes: 125,
    synopsis:
      'Dziewczynka trafia do świata duchów i musi uratować rodziców zamienionych w świnie.',
    averageRating: '8.77',
    ratingCount: 1_890,
    popularityScore: 8_400,
    genreSlugs: ['przygodowe', 'fantasy', 'nadprzyrodzone'],
    studio: 'Studio Ghibli',
  },
  {
    titleRomaji: 'Mushoku Tensei: Isekai Ittara Honki Dasu',
    titleEnglish: 'Mushoku Tensei: Jobless Reincarnation',
    titleNative: '無職転生 〜異世界行ったら本気だす〜',
    format: 'tv',
    status: 'releasing',
    season: 'winter',
    seasonYear: 2021,
    episodeCount: 11,
    durationMinutes: 24,
    synopsis: 'Bezrobotny mężczyzna odradza się w świecie magii, postanawiając przeżyć życie na nowo.',
    averageRating: '8.36',
    ratingCount: 640,
    popularityScore: 6_900,
    genreSlugs: ['fantasy', 'przygodowe', 'dramat'],
    studio: 'Bones',
  },
  {
    titleRomaji: 'Koe no Katachi',
    titleEnglish: 'A Silent Voice',
    titleNative: '聲の形',
    format: 'movie',
    status: 'finished',
    season: null,
    seasonYear: 2016,
    episodeCount: 1,
    durationMinutes: 130,
    synopsis: 'Były prześladowca próbuje odkupić winy wobec niesłyszącej koleżanki.',
    averageRating: '8.94',
    ratingCount: 1_050,
    popularityScore: 7_800,
    genreSlugs: ['dramat', 'romans', 'okruchy-zycia'],
    studio: 'Kyoto Animation',
  },
];

async function main(): Promise<void> {
  const { db, sql: connection } = createDatabase({ maxConnections: 1 });

  console.log('Seeding development data…');

  try {
    // Genres. onConflictDoNothing keeps the seed idempotent.
    await db.insert(genres).values([...CORE_GENRES]).onConflictDoNothing();

    await db
      .insert(organizations)
      .values(STUDIOS.map((name) => ({ slug: slugify(name), name })))
      .onConflictDoNothing();

    const genreRows = await db.select({ id: genres.id, slug: genres.slug }).from(genres);
    const genreBySlug = new Map(genreRows.map((row) => [row.slug, row.id]));

    const orgRows = await db.select({ id: organizations.id, slug: organizations.slug }).from(organizations);
    const orgBySlug = new Map(orgRows.map((row) => [row.slug, row.id]));

    // Franchises, so related works group without pretending to be seasons.
    const franchiseNames = [...new Set(TITLES.flatMap((t) => (t.franchise ? [t.franchise] : [])))];
    if (franchiseNames.length > 0) {
      await db
        .insert(franchises)
        .values(franchiseNames.map((name) => ({ slug: slugify(name), name })))
        .onConflictDoNothing();
    }

    const franchiseRows = await db.select({ id: franchises.id, slug: franchises.slug }).from(franchises);
    const franchiseBySlug = new Map(franchiseRows.map((row) => [row.slug, row.id]));

    let created = 0;

    for (const title of TITLES) {
      const slug = slugify(title.titleRomaji);

      const [seriesRow] = await db
        .insert(series)
        .values({
          slug,
          franchiseId: title.franchise ? (franchiseBySlug.get(slugify(title.franchise)) ?? null) : null,
          title: title.titleRomaji,
          synopsis: title.synopsis,
          averageRating: title.averageRating,
          ratingCount: title.ratingCount,
          popularityScore: title.popularityScore,
        })
        .onConflictDoNothing({ target: series.slug })
        .returning({ id: series.id });

      if (seriesRow === undefined) continue;
      created += 1;

      const [entryRow] = await db
        .insert(entries)
        .values({
          seriesId: seriesRow.id,
          slug: 'main',
          entryType: title.format,
          titleRomaji: title.titleRomaji,
          titleEnglish: title.titleEnglish,
          titleNative: title.titleNative,
          synopsis: title.synopsis,
          status: title.status,
          airingSeason: title.season,
          airingYear: title.seasonYear,
          episodeCount: title.episodeCount,
          durationMinutes: title.durationMinutes,
        })
        .returning({ id: entries.id });

      if (entryRow === undefined) continue;

      await db.insert(entryGenres).values(
        title.genreSlugs.flatMap((genreSlug) => {
          const genreId = genreBySlug.get(genreSlug);
          return genreId === undefined ? [] : [{ entryId: entryRow.id, genreId }];
        }),
      );

      const studioId = orgBySlug.get(slugify(title.studio));
      if (studioId !== undefined) {
        await db
          .insert(entryOrganizations)
          .values({ entryId: entryRow.id, organizationId: studioId, role: 'studio', isPrimary: true });
      }

      // Placeholder artwork: a deterministic gradient keyed by slug, so cards
      // render without shipping binary assets in the repository.
      await db.insert(mediaAssets).values({
        seriesId: seriesRow.id,
        entryId: entryRow.id,
        kind: 'poster',
        url: `https://placehold.co/460x650/1a1d29/e8eaf0?text=${encodeURIComponent(title.titleRomaji.slice(0, 24))}`,
        width: 460,
        height: 650,
        isPrimary: true,
      });

      // Episodes directly on the entry — films get a single episode row.
      const episodeCount = Math.min(title.episodeCount ?? 1, 12);
      if (episodeCount > 0) {
        await db.insert(episodes).values(
          Array.from({ length: episodeCount }, (_, index) => ({
            entryId: entryRow.id,
            number: index + 1,
            absoluteNumber: index + 1,
            title: title.format === 'movie' ? title.titleRomaji : `Odcinek ${String(index + 1)}`,
            durationSeconds: (title.durationMinutes ?? 24) * 60,
            // Realistic skip ranges for TV episodes; films have no OP.
            introStartSeconds: title.format === 'movie' ? null : 60,
            introEndSeconds: title.format === 'movie' ? null : 150,
          })),
        );
      }
    }

    const [{ count: total } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(series);

    console.log(`Seed complete: ${String(created)} new titles, ${String(total)} total.`);
  } finally {
    await connection.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
