import { and, desc, eq, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { NotFoundError, ValidationError, buildCursorPage, decodeCursor, encodeCursor, slugify } from '@playanime/shared';
import { AdminRepository, blogPosts, db, users, type Database } from '@playanime/database';
import type {
  BlogPostCreateBody,
  BlogPostDetailDto,
  BlogPostListPage,
  BlogPostStatus,
  BlogPostSummaryDto,
  BlogPostUpdateBody,
} from '@playanime/contracts';
import { ModerationAction } from '@playanime/contracts';

/**
 * Platform blog — admin-authored announcements/news. See
 * `packages/contracts/src/blog/index.ts` for the full design rationale.
 *
 * No repository class of its own — this is a single, simple table with no
 * cross-module read pattern anything else needs, so (matching `contact`'s
 * own module, not `catalogue`'s repository-class pattern) queries live
 * directly here. `AdminRepository.audit()` is reused for the audit trail,
 * same as every other admin-authored mutation in this codebase.
 */

const adminRepository = new AdminRepository(db());
const MAX_SLUG_ATTEMPTS = 25;

interface PublicCursor {
  readonly v: string;
  readonly id: string;
}

async function slugTaken(database: Database, slug: string, excludePostId?: string): Promise<boolean> {
  const [row] = await database.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.slug, slug)).limit(1);
  if (row === undefined) return false;
  return excludePostId === undefined || row.id !== excludePostId;
}

/** Never client-supplied, same reasoning as `catalogue.service.ts`'s own `deriveSlug`: a slug is permanent and appears in every link. */
async function deriveSlug(database: Database, title: string, excludePostId?: string): Promise<string> {
  const base = slugify(title);

  if (base.length === 0) {
    throw new ValidationError('Tytuł musi zawierać litery lub cyfry.', [
      { path: 'title', message: 'Nieprawidłowy tytuł.' },
    ]);
  }

  if (!(await slugTaken(database, base, excludePostId))) return base;

  for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS; suffix += 1) {
    const candidate = `${base.slice(0, 92)}-${String(suffix)}`;
    if (!(await slugTaken(database, candidate, excludePostId))) return candidate;
  }

  throw new ValidationError('Nie udało się utworzyć unikalnego adresu dla tego wpisu.', [
    { path: 'title', message: 'Spróbuj innego tytułu.' },
  ]);
}

const summaryColumns = {
  id: blogPosts.id,
  slug: blogPosts.slug,
  title: blogPosts.title,
  excerpt: blogPosts.excerpt,
  coverImageUrl: blogPosts.coverImageUrl,
  authorUsername: users.username,
  publishedAt: blogPosts.publishedAt,
};

const detailColumns = {
  ...summaryColumns,
  contentMarkdown: blogPosts.contentMarkdown,
  status: blogPosts.status,
  createdAt: blogPosts.createdAt,
  updatedAt: blogPosts.updatedAt,
};

function toSummaryDto(row: {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  authorUsername: string | null;
  publishedAt: Date | null;
}): BlogPostSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverImageUrl: row.coverImageUrl,
    // A post's author account being later deleted (authorUserId -> set
    // null) must not break the public list — falls back to a generic
    // label rather than a null the DTO doesn't allow.
    authorUsername: row.authorUsername ?? 'PlayAnime',
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

function toDetailDto(row: {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverImageUrl: string | null;
  authorUsername: string | null;
  status: BlogPostStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): BlogPostDetailDto {
  return {
    ...toSummaryDto(row),
    contentMarkdown: row.contentMarkdown,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Public list — published posts whose `publishedAt` has already passed,
 * newest first. A scheduled-but-not-yet-live post is invisible here even
 * though its row exists (see contracts doc comment).
 */
export async function listPublicBlogPosts(
  limit: number,
  cursor: string | undefined,
  database: Database = db(),
): Promise<BlogPostListPage> {
  const decoded = cursor === undefined ? null : (decodeCursor(cursor) as PublicCursor | null);
  const keyset: SQL | undefined =
    decoded === null
      ? undefined
      : or(
          lt(blogPosts.publishedAt, new Date(decoded.v)),
          and(eq(blogPosts.publishedAt, new Date(decoded.v)), lt(blogPosts.id, decoded.id)),
        );

  const rows = await database
    .select(summaryColumns)
    .from(blogPosts)
    .leftJoin(users, eq(users.id, blogPosts.authorUserId))
    .where(and(eq(blogPosts.status, 'published'), lte(blogPosts.publishedAt, sql`now()`), keyset))
    .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.id))
    .limit(limit + 1);

  const page = buildCursorPage(rows, limit, (row) =>
    encodeCursor({ v: (row.publishedAt ?? new Date(0)).toISOString(), id: row.id }),
  );

  return { items: page.items.map(toSummaryDto), nextCursor: page.nextCursor, hasMore: page.hasMore };
}

/** Public detail by slug — 404s for a draft or a not-yet-scheduled post, not just a missing one, so a leaked draft URL reveals nothing. */
export async function getPublicBlogPostBySlug(
  slug: string,
  database: Database = db(),
): Promise<BlogPostDetailDto> {
  const [row] = await database
    .select(detailColumns)
    .from(blogPosts)
    .leftJoin(users, eq(users.id, blogPosts.authorUserId))
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, 'published'), lte(blogPosts.publishedAt, sql`now()`)))
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError('Nie znaleziono tego wpisu.');
  }

  return toDetailDto(row);
}

/** Admin list — every post regardless of status, optionally filtered. No published-time gate: staff needs to see a scheduled post before it goes live. */
export async function listAdminBlogPosts(
  status: BlogPostStatus | undefined,
  limit: number,
  cursor: string | undefined,
  database: Database = db(),
): Promise<BlogPostListPage> {
  const decoded = cursor === undefined ? null : (decodeCursor(cursor) as PublicCursor | null);
  const keyset: SQL | undefined =
    decoded === null
      ? undefined
      : or(
          lt(blogPosts.createdAt, new Date(decoded.v)),
          and(eq(blogPosts.createdAt, new Date(decoded.v)), lt(blogPosts.id, decoded.id)),
        );

  const rows = await database
    .select({ ...summaryColumns, createdAt: blogPosts.createdAt })
    .from(blogPosts)
    .leftJoin(users, eq(users.id, blogPosts.authorUserId))
    .where(and(status === undefined ? undefined : eq(blogPosts.status, status), keyset))
    .orderBy(desc(blogPosts.createdAt), desc(blogPosts.id))
    .limit(limit + 1);

  const page = buildCursorPage(rows, limit, (row) => encodeCursor({ v: row.createdAt.toISOString(), id: row.id }));

  return { items: page.items.map(toSummaryDto), nextCursor: page.nextCursor, hasMore: page.hasMore };
}

/** Admin detail by id — no status/publish-time gate, since staff needs to open and edit a draft. */
export async function getAdminBlogPost(postId: string, database: Database = db()): Promise<BlogPostDetailDto> {
  const [row] = await database
    .select(detailColumns)
    .from(blogPosts)
    .leftJoin(users, eq(users.id, blogPosts.authorUserId))
    .where(eq(blogPosts.id, postId))
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError('Nie znaleziono tego wpisu.');
  }

  return toDetailDto(row);
}

export interface AuthorContext {
  readonly actorUserId: string;
}

export async function createBlogPost(
  actor: AuthorContext,
  input: BlogPostCreateBody,
  database: Database = db(),
): Promise<BlogPostDetailDto> {
  const slug = await deriveSlug(database, input.title);

  const [created] = await database
    .insert(blogPosts)
    .values({
      slug,
      title: input.title,
      excerpt: input.excerpt ?? null,
      contentMarkdown: input.contentMarkdown ?? '',
      coverImageUrl: input.coverImageUrl ?? null,
      authorUserId: actor.actorUserId,
      status: 'draft',
    })
    .returning({ id: blogPosts.id });

  if (created === undefined) throw new Error('Blog post insert returned no row.');

  await adminRepository.audit({
    action: ModerationAction.CREATE_BLOG_POST,
    actorUserId: actor.actorUserId,
    targetType: 'blog_post',
    targetId: created.id,
    newStatus: 'draft',
    metadata: { title: input.title, slug },
  });

  return getAdminBlogPost(created.id, database);
}

export async function updateBlogPost(
  actor: AuthorContext,
  postId: string,
  input: BlogPostUpdateBody,
  database: Database = db(),
): Promise<BlogPostDetailDto> {
  const [existing] = await database.select().from(blogPosts).where(eq(blogPosts.id, postId)).limit(1);
  if (existing === undefined) {
    throw new NotFoundError('Nie znaleziono tego wpisu.');
  }

  // A slug is only re-derived when the title actually changes AND the post
  // has never been published — once a post has gone live at least once,
  // its slug is permanent (same "a slug appears in every link" reasoning
  // as the catalogue's own titles), so a title edit on an already-published
  // post updates the displayed title without moving its URL.
  const titleChanged = input.title !== undefined && input.title !== existing.title;
  const everPublished = existing.status === 'published' || existing.publishedAt !== null;
  const nextSlug =
    titleChanged && !everPublished && input.title !== undefined
      ? await deriveSlug(database, input.title, postId)
      : existing.slug;

  // Publishing (status transitioning TO 'published') with no explicit
  // publishedAt stamps "now" — this is what makes clicking "Publish" with
  // no scheduled date behave as "goes live immediately," while an
  // explicit future publishedAt (set via a separate field on the same
  // request) schedules it instead.
  const willPublish = input.status === 'published' && existing.status !== 'published';
  const nextPublishedAt =
    input.publishedAt !== undefined
      ? input.publishedAt === null
        ? null
        : new Date(input.publishedAt)
      : willPublish
        ? new Date()
        : existing.publishedAt;

  await database
    .update(blogPosts)
    .set({
      slug: nextSlug,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
      ...(input.contentMarkdown === undefined ? {} : { contentMarkdown: input.contentMarkdown }),
      ...(input.coverImageUrl === undefined ? {} : { coverImageUrl: input.coverImageUrl }),
      ...(input.status === undefined ? {} : { status: input.status }),
      publishedAt: nextPublishedAt,
    })
    .where(eq(blogPosts.id, postId));

  await adminRepository.audit({
    action: ModerationAction.UPDATE_BLOG_POST,
    actorUserId: actor.actorUserId,
    targetType: 'blog_post',
    targetId: postId,
    previousStatus: existing.status,
    newStatus: input.status ?? existing.status,
    metadata: { titleChanged, slugChanged: nextSlug !== existing.slug },
  });

  return getAdminBlogPost(postId, database);
}

export async function deleteBlogPost(actor: AuthorContext, postId: string, database: Database = db()): Promise<void> {
  const [existing] = await database.select({ status: blogPosts.status }).from(blogPosts).where(eq(blogPosts.id, postId)).limit(1);
  if (existing === undefined) {
    throw new NotFoundError('Nie znaleziono tego wpisu.');
  }

  await database.delete(blogPosts).where(eq(blogPosts.id, postId));

  await adminRepository.audit({
    action: ModerationAction.DELETE_BLOG_POST,
    actorUserId: actor.actorUserId,
    targetType: 'blog_post',
    targetId: postId,
    previousStatus: existing.status,
  });
}
