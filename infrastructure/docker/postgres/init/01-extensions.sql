-- Extensions the schema depends on.
--
-- Runs once, on first initialization of the data volume, before any migration.
-- Keeping this out of migrations matters because CREATE EXTENSION needs
-- superuser rights that the application role should not have in production.

-- Trigram matching, for fuzzy title search. The anime_title_trgm_idx GIN index
-- cannot be created without it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Accent-insensitive comparison, so "Kimetsu no Yaiba" matches a query typed
-- without diacritics.
CREATE EXTENSION IF NOT EXISTS unaccent;
