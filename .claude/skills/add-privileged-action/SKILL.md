---
name: add-privileged-action
description: Add a new moderator/admin/staff action to PlayAnime with correct authorization and an audit trail. Use whenever a task adds an endpoint or service function that suspends, bans, removes, approves, rejects, or otherwise changes status on behalf of staff rather than the resource's own owner.
---

# Adding a privileged (moderator/admin) action

Every privileged mutation in this codebase writes an append-only row to
`moderation_audit_log` — actor, action, previous/new status, reason. This is
not optional for a new one; it's how a moderator's decisions stay
reconstructable later ("why was this suspended?") and it cannot do its job
if some actions skip it.

## Authorization: platform role vs. group role — know which one applies

This codebase has **two separate, non-overlapping authorization models** —
picking the wrong one is a real security bug, not just a style issue:

- **Platform staff** (`UserRole`: `user` < `moderator` < `admin`, ranked via
  `hasAtLeastRole()` / `ROLE_RANK` in `packages/contracts/src/auth/index.ts`)
  — for site-wide moderation: suspending an account, removing a comment,
  disabling a source, approving/rejecting a report. Guard with
  `requireAuth(session)` plus an explicit role check, or look at how
  `admin.controller.ts` routes gate themselves.
- **Group role** (`TranslatorRole`: `member` < `timer`/`typesetter` <
  `translator` < `editor` < `leader`, ranked via
  `hasAtLeastTranslatorRole()` / `TRANSLATOR_ROLE_RANK`) — for actions
  *within* a specific translator group (editing group settings, inviting a
  member, claiming a title). A group leader is not thereby a platform
  moderator, and a platform admin does not automatically have group-editor
  rights on a group they don't belong to — `translators.service.ts`'s doc
  comment states this explicitly: staff intervene only through the audited
  moderation path, never by borrowing group authority.

Decide which model the new action belongs to before writing the guard. If
it's ambiguous, it's probably platform staff (moderation queue, reports,
suspensions) — group-scoped actions are almost always initiated by the
group's own members.

## Steps

1. **Write the service function** taking the actor's identity as an explicit
   parameter (`actorUserId`, `actorIpAddress` if relevant) — never infer it
   from ambient session state buried in the function, so the audit call
   downstream always has what it needs.

2. **Check authorization inside the service, not just the controller.** The
   controller's route guard (`requireAuth`, a role check) is the first line;
   the service function should still verify the actor is allowed to act on
   *this specific target* (e.g. staff role high enough, or — for a group
   action — actual membership at the required rank via a repository lookup
   like `TranslatorRepository.membership()`), since a controller-only check
   is easy to bypass by calling the service from a different route later.

3. **Perform the mutation and the audit write together** — same transaction
   if the repository method supports one, or immediately after with no
   other work in between. Use the existing `audit()` helper in
   `AdminRepository` (`packages/database/src/repositories/admin.repository.ts`)
   rather than inserting into `moderation_audit_log` by hand:

   ```ts
   await repository.audit({
     action: 'suspend_user', // one of moderationActionEnum's values
     actorUserId: actor.id,
     targetType: 'user',
     targetId: target.id,
     previousStatus: previousStatus,
     newStatus: newStatus,
     reason: input.reason ?? null,
   });
   ```

   If `action` needs a new enum value, add it to `MODERATION_ACTIONS` in
   `packages/contracts/src/anime/enums.ts` (or wherever the enum actually
   lives in this checkout — grep for `MODERATION_ACTIONS`) and regenerate
   the migration for the Postgres enum (see the `add-migration` skill) —
   the enum is derived from the same contracts constant on both sides, so
   they can't drift.

4. **Never let the audit row be editable or deletable.** It's append-only by
   design (see the doc comment on `AdminRepository.audit()`) — a
   moderator's history has to survive even a later, different decision.

## Verification

- Confirm the audit row actually appears after the action, via the
  `verify-against-live-stack` skill — query `moderation_audit_log` directly
  rather than trusting the service function's return value.
- Confirm the wrong-role case is actually rejected: call the endpoint as a
  plain user (or, for a group action, as a member below the required rank)
  and check it 403s rather than silently succeeding.
