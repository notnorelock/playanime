import { describe, expect, it } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { registerTestFormats } from './formats.js';
import {
  Comment,
  CommentCreateBody,
  CommentLikeResponse,
  EpisodeRatingSummary,
  REACTION_KINDS,
  RatingUpsertBody,
  ReactionKind,
  ReactionToggleBody,
  ReviewCreateBody,
} from '../src/index.js';

/**
 * Engagement contracts.
 *
 * These cover the fields added for episode-scoped engagement and comment
 * likes. The nullable aggregates matter most: an episode nobody has rated must
 * report `null`, not a fabricated zero that would render as a 0/10 score.
 */

const author = {
  userId: '00000000-0000-4000-8000-000000000001',
  username: 'tester',
  displayName: null,
  avatar: null,
};

function comment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    animeId: null,
    episodeId: '00000000-0000-4000-8000-000000000003',
    parentId: null,
    author,
    body: 'Dobry odcinek.',
    rating: null,
    hasSpoilers: false,
    likeCount: 0,
    replyCount: 0,
    isLikedByViewer: false,
    canEdit: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// `Value.Check` fails open on an unregistered format, which would make every
// uuid and uri assertion below vacuous.
registerTestFormats();

describe('Comment', () => {
  it('accepts an episode comment', () => {
    expect(Value.Check(Comment, comment())).toBe(true);
  });

  it('requires the viewer like flag', () => {
    // Without it the client cannot render a liked state, and would have to
    // guess — which is how a like counter drifts from its rows.
    const { isLikedByViewer: _omitted, ...withoutFlag } = comment();
    expect(Value.Check(Comment, withoutFlag)).toBe(false);
  });

  it('rejects a negative like count', () => {
    expect(Value.Check(Comment, comment({ likeCount: -1 }))).toBe(false);
  });

  it('allows a comment attached to a title rather than an episode', () => {
    expect(
      Value.Check(
        Comment,
        comment({ animeId: '00000000-0000-4000-8000-000000000004', episodeId: null }),
      ),
    ).toBe(true);
  });
});

describe('CommentLikeResponse', () => {
  it('returns the authoritative count with the resulting state', () => {
    expect(
      Value.Check(CommentLikeResponse, {
        commentId: '00000000-0000-4000-8000-000000000002',
        likeCount: 3,
        isLikedByViewer: true,
      }),
    ).toBe(true);
  });

  it('rejects a negative count', () => {
    expect(
      Value.Check(CommentLikeResponse, {
        commentId: '00000000-0000-4000-8000-000000000002',
        likeCount: -1,
        isLikedByViewer: false,
      }),
    ).toBe(false);
  });
});

describe('EpisodeRatingSummary', () => {
  const base = {
    episodeId: '00000000-0000-4000-8000-000000000003',
    averageScore: null,
    ratingCount: 0,
    viewerScore: null,
    reactions: {},
    viewerReactions: [],
  };

  it('reports null rather than zero for an unrated episode', () => {
    // A fabricated 0 would render as the worst possible score for an episode
    // nobody has rated at all.
    expect(Value.Check(EpisodeRatingSummary, base)).toBe(true);
  });

  it('accepts a populated aggregate', () => {
    expect(
      Value.Check(EpisodeRatingSummary, {
        ...base,
        averageScore: 8.5,
        ratingCount: 2,
        viewerScore: 9,
        reactions: { fire: 1 },
        viewerReactions: [ReactionKind.FIRE],
      }),
    ).toBe(true);
  });

  it('rejects an average outside the 0-10 range', () => {
    expect(Value.Check(EpisodeRatingSummary, { ...base, averageScore: 11 })).toBe(false);
  });

  it('rejects a viewer score outside the 1-10 range', () => {
    expect(Value.Check(EpisodeRatingSummary, { ...base, viewerScore: 0 })).toBe(false);
    expect(Value.Check(EpisodeRatingSummary, { ...base, viewerScore: 11 })).toBe(false);
  });

  it('rejects a reaction kind outside the enum', () => {
    expect(Value.Check(EpisodeRatingSummary, { ...base, viewerReactions: ['clap'] })).toBe(false);
  });
});

describe('ReactionToggleBody', () => {
  it('accepts every declared reaction kind', () => {
    for (const kind of REACTION_KINDS) {
      expect(Value.Check(ReactionToggleBody, { kind })).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    expect(Value.Check(ReactionToggleBody, { kind: 'clap' })).toBe(false);
  });
});

describe('rating and comment bodies', () => {
  it('bounds a score to whole stars from 1 to 10', () => {
    expect(Value.Check(RatingUpsertBody, { score: 1 })).toBe(true);
    expect(Value.Check(RatingUpsertBody, { score: 10 })).toBe(true);
    expect(Value.Check(RatingUpsertBody, { score: 0 })).toBe(false);
    expect(Value.Check(RatingUpsertBody, { score: 11 })).toBe(false);
    // Half-points would invalidate every existing row if introduced later.
    expect(Value.Check(RatingUpsertBody, { score: 7.5 })).toBe(false);
  });

  it('rejects an empty comment body', () => {
    expect(Value.Check(CommentCreateBody, { body: '' })).toBe(false);
    expect(Value.Check(CommentCreateBody, { body: 'ok' })).toBe(true);
  });

  it('requires a score on a review', () => {
    expect(Value.Check(ReviewCreateBody, { body: 'Recenzja' })).toBe(false);
    expect(Value.Check(ReviewCreateBody, { body: 'Recenzja', rating: 8 })).toBe(true);
  });
});
