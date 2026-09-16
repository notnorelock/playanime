import { describe, expect, it } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { registerTestFormats } from './formats.js';
import {
  TRANSLATOR_APPLICATION_STATUSES,
  TRANSLATOR_ROLES,
  TRANSLATOR_ROLE_RANK,
  TranslatorApplicationStatus,
  TranslatorGroupCreateBody,
  TranslatorGroupUpdateBody,
  TranslatorMemberInviteBody,
  TranslatorRole,
  hasAtLeastTranslatorRole,
} from '../src/index.js';

/**
 * Translator group contracts.
 *
 * The role comparison is what every group mutation is gated on, so it is
 * tested directly rather than only through the endpoints that call it: a
 * silent inversion here would let any member administer a group.
 */

// `Value.Check` fails open on an unregistered format, which would make every
// uuid and uri assertion below vacuous.
registerTestFormats();

describe('translator role ranking', () => {
  it('lets a leader do anything a lower role can', () => {
    for (const role of TRANSLATOR_ROLES) {
      expect(hasAtLeastTranslatorRole(TranslatorRole.LEADER, role)).toBe(true);
    }
  });

  it('refuses a member acting at any elevated role', () => {
    const elevated = TRANSLATOR_ROLES.filter((role) => role !== TranslatorRole.MEMBER);

    for (const role of elevated) {
      expect(hasAtLeastTranslatorRole(TranslatorRole.MEMBER, role)).toBe(false);
    }
  });

  it('treats every role as sufficient for itself', () => {
    for (const role of TRANSLATOR_ROLES) {
      expect(hasAtLeastTranslatorRole(role, role)).toBe(true);
    }
  });

  it('does not let an editor act as a leader', () => {
    expect(hasAtLeastTranslatorRole(TranslatorRole.EDITOR, TranslatorRole.LEADER)).toBe(false);
    expect(hasAtLeastTranslatorRole(TranslatorRole.LEADER, TranslatorRole.EDITOR)).toBe(true);
  });

  it('ranks leader strictly above every other role', () => {
    const others = TRANSLATOR_ROLES.filter((role) => role !== TranslatorRole.LEADER);

    for (const role of others) {
      expect(TRANSLATOR_ROLE_RANK[TranslatorRole.LEADER]).toBeGreaterThan(
        TRANSLATOR_ROLE_RANK[role],
      );
    }
  });

  it('assigns a rank to every declared role', () => {
    // A role missing from the rank table would compare as `undefined` and make
    // every check involving it silently false.
    for (const role of TRANSLATOR_ROLES) {
      expect(typeof TRANSLATOR_ROLE_RANK[role]).toBe('number');
    }
  });
});

describe('TranslatorGroupCreateBody', () => {
  it('accepts a minimal group', () => {
    expect(Value.Check(TranslatorGroupCreateBody, { name: 'Grupa Testowa' })).toBe(true);
  });

  it('rejects a name shorter than two characters', () => {
    expect(Value.Check(TranslatorGroupCreateBody, { name: 'A' })).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(Value.Check(TranslatorGroupCreateBody, { description: 'bez nazwy' })).toBe(false);
  });

  it('rejects a non-URI website', () => {
    expect(
      Value.Check(TranslatorGroupCreateBody, { name: 'Grupa', websiteUrl: 'not a url' }),
    ).toBe(false);
  });

  it('has no slug field: the server derives it from the name', () => {
    // Accepting a client-chosen slug would invite squatting on the slugs of
    // well-known groups, so the property must not exist on the contract.
    expect(Object.keys(TranslatorGroupCreateBody.properties)).not.toContain('slug');
  });
});

describe('TranslatorGroupUpdateBody', () => {
  it('accepts an empty patch', () => {
    expect(Value.Check(TranslatorGroupUpdateBody, {})).toBe(true);
  });

  it('cannot rename a group', () => {
    // Renaming breaks every link to a group and is how impersonation happens,
    // so it is a moderator action rather than a self-service one.
    expect(Object.keys(TranslatorGroupUpdateBody.properties)).not.toContain('name');
    expect(Object.keys(TranslatorGroupUpdateBody.properties)).not.toContain('slug');
  });

  it('allows clearing a nullable field', () => {
    expect(Value.Check(TranslatorGroupUpdateBody, { description: null })).toBe(true);
  });
});

describe('TranslatorMemberInviteBody', () => {
  it('invites by username', () => {
    expect(Value.Check(TranslatorMemberInviteBody, { username: 'tester' })).toBe(true);
  });

  it('rejects a username shorter than the account minimum', () => {
    expect(Value.Check(TranslatorMemberInviteBody, { username: 'ab' })).toBe(false);
  });

  it('accepts an explicit role', () => {
    expect(
      Value.Check(TranslatorMemberInviteBody, {
        username: 'tester',
        role: TranslatorRole.TRANSLATOR,
      }),
    ).toBe(true);
  });

  it('rejects a role outside the enum', () => {
    expect(Value.Check(TranslatorMemberInviteBody, { username: 'tester', role: 'owner' })).toBe(
      false,
    );
  });
});

describe('application statuses', () => {
  it('declares exactly the four lifecycle states', () => {
    expect([...TRANSLATOR_APPLICATION_STATUSES].sort()).toEqual([
      'accepted',
      'pending',
      'rejected',
      'withdrawn',
    ]);
  });

  it('starts at pending', () => {
    expect(TranslatorApplicationStatus.PENDING).toBe('pending');
  });
});
