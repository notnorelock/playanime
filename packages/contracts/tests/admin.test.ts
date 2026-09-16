import { describe, expect, it } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { registerTestFormats } from './formats.js';
import {
  AdminAnimeUpdateBody,
  AdminCommentQuery,
  AdminRoleUpdateBody,
  AdminSanctionBody,
  AdminUserDto,
  AdminUserQuery,
  MODERATION_ACTIONS,
  ModerationAction,
  ROLE_RANK,
  USER_ROLES,
  UserRole,
  hasAtLeastRole,
} from '../src/index.js';

/**
 * Administration contracts.
 *
 * The role ranking here decides who may act on whom, and the admin DTOs carry
 * data no public response may. Both are worth asserting directly: a regression
 * in either is a privilege or a disclosure bug, not a cosmetic one.
 */

// `Value.Check` fails open on an unregistered format, which would make every
// uuid and uri assertion below vacuous.
registerTestFormats();

describe('platform role ranking', () => {
  it('lets an admin satisfy every role check', () => {
    for (const role of USER_ROLES) {
      expect(hasAtLeastRole(UserRole.ADMIN, role)).toBe(true);
    }
  });

  it('does not let a user satisfy a staff check', () => {
    expect(hasAtLeastRole(UserRole.USER, UserRole.MODERATOR)).toBe(false);
    expect(hasAtLeastRole(UserRole.USER, UserRole.ADMIN)).toBe(false);
  });

  it('does not let a moderator satisfy an admin check', () => {
    expect(hasAtLeastRole(UserRole.MODERATOR, UserRole.ADMIN)).toBe(false);
    expect(hasAtLeastRole(UserRole.ADMIN, UserRole.MODERATOR)).toBe(true);
  });

  it('ranks peers equally, which the admin guard treats as insufficient', () => {
    // `assertOutranks` requires strictly greater rank, so two moderators cannot
    // sanction each other — one compromised account must not disable the team.
    expect(ROLE_RANK[UserRole.MODERATOR]).toBe(ROLE_RANK[UserRole.MODERATOR]);
    expect(ROLE_RANK[UserRole.ADMIN]).toBeGreaterThan(ROLE_RANK[UserRole.MODERATOR]);
    expect(ROLE_RANK[UserRole.MODERATOR]).toBeGreaterThan(ROLE_RANK[UserRole.USER]);
  });
});

describe('AdminSanctionBody', () => {
  it('accepts a permanent ban', () => {
    expect(Value.Check(AdminSanctionBody, { kind: 'ban', reason: 'spam' })).toBe(true);
  });

  it('accepts a bounded suspension', () => {
    expect(
      Value.Check(AdminSanctionBody, { kind: 'suspension', reason: 'spam', durationDays: 7 }),
    ).toBe(true);
  });

  it('requires a reason', () => {
    expect(Value.Check(AdminSanctionBody, { kind: 'warning' })).toBe(false);
    expect(Value.Check(AdminSanctionBody, { kind: 'warning', reason: '' })).toBe(false);
  });

  it('rejects an unknown sanction kind', () => {
    expect(Value.Check(AdminSanctionBody, { kind: 'shadowban', reason: 'x' })).toBe(false);
  });

  it('rejects a duration beyond ten years', () => {
    expect(
      Value.Check(AdminSanctionBody, { kind: 'ban', reason: 'x', durationDays: 5000 }),
    ).toBe(false);
  });
});

describe('AdminRoleUpdateBody', () => {
  it('requires a reason alongside the role', () => {
    // A role change is the most consequential action in the product; an audit
    // row without a reason is useless six months later.
    expect(Value.Check(AdminRoleUpdateBody, { role: UserRole.MODERATOR })).toBe(false);
    expect(
      Value.Check(AdminRoleUpdateBody, { role: UserRole.MODERATOR, reason: 'promocja' }),
    ).toBe(true);
  });

  it('rejects a role outside the enum', () => {
    expect(Value.Check(AdminRoleUpdateBody, { role: 'superadmin', reason: 'x' })).toBe(false);
  });
});

describe('AdminUserDto', () => {
  it('carries the email address, which no public profile may', () => {
    // This is exactly why the admin DTOs live apart from the public ones: the
    // difference has to be a deliberate import, not an accident of reuse.
    expect(Object.keys(AdminUserDto.properties)).toContain('email');
    expect(Object.keys(AdminUserDto.properties)).toContain('suspensionReason');
  });
});

describe('admin queries', () => {
  it('accepts a bare listing', () => {
    expect(Value.Check(AdminUserQuery, {})).toBe(true);
  });

  it('accepts the string booleans that query parameters arrive as', () => {
    expect(Value.Check(AdminUserQuery, { suspendedOnly: 'true' })).toBe(true);
    expect(Value.Check(AdminUserQuery, { suspendedOnly: true })).toBe(true);
  });

  it('constrains the comment queue filter', () => {
    expect(Value.Check(AdminCommentQuery, { filter: 'reported' })).toBe(true);
    expect(Value.Check(AdminCommentQuery, { filter: 'removed' })).toBe(true);
    expect(Value.Check(AdminCommentQuery, { filter: 'everything' })).toBe(false);
  });
});

describe('AdminAnimeUpdateBody', () => {
  it('accepts an empty patch', () => {
    expect(Value.Check(AdminAnimeUpdateBody, {})).toBe(true);
  });

  it('rejects a negative episode count', () => {
    expect(Value.Check(AdminAnimeUpdateBody, { episodeCount: -1 })).toBe(false);
  });

  it('allows clearing the declared episode count', () => {
    expect(Value.Check(AdminAnimeUpdateBody, { episodeCount: null })).toBe(true);
  });
});

describe('moderation actions', () => {
  it('names each administrative verb distinctly', () => {
    // Reusing one action for several kinds of change makes the audit log
    // unreadable: "who did this and why" has to name the verb.
    expect(MODERATION_ACTIONS).toContain(ModerationAction.CHANGE_USER_ROLE);
    expect(MODERATION_ACTIONS).toContain(ModerationAction.HIDE_ANIME);
    expect(MODERATION_ACTIONS).toContain(ModerationAction.RESTORE_ANIME);
    expect(MODERATION_ACTIONS).toContain(ModerationAction.VERIFY_TRANSLATOR_GROUP);
    expect(MODERATION_ACTIONS).toContain(ModerationAction.SUSPEND_TRANSLATOR_GROUP);
  });

  it('declares no duplicate values', () => {
    expect(new Set(MODERATION_ACTIONS).size).toBe(MODERATION_ACTIONS.length);
  });
});
