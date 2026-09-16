import { UserRole, hasAtLeastRole, type SessionUser } from '@playanime/contracts'

/**
 * Role checks.
 *
 * The comparison itself comes from `@playanime/contracts` — the same ranked
 * table the API's guards use — so the UI can never disagree with the server
 * about who outranks whom. These functions decide what to *render*; the server
 * decides what is *allowed*, and hiding a control is never the access check.
 *
 * The previous implementation read `user.roles` as an array of role objects,
 * which the old backend returned. The current session carries a single `role`
 * string, so every one of those checks silently evaluated to false.
 */

export function isAdmin(user: SessionUser | null): boolean {
  return user !== null && hasAtLeastRole(user.role, UserRole.ADMIN)
}

/** True for moderators and admins: roles are ranked, so admin passes. */
export function isModerator(user: SessionUser | null): boolean {
  return user !== null && hasAtLeastRole(user.role, UserRole.MODERATOR)
}

/** True when the user holds at least `required`. */
export function hasRole(user: SessionUser | null, required: UserRole): boolean {
  return user !== null && hasAtLeastRole(user.role, required)
}

/** Whether the user is staff of any kind, for showing staff-only navigation. */
export function isStaff(user: SessionUser | null): boolean {
  return isModerator(user)
}

/** Display label for a role. */
export function roleLabel(role: UserRole): string {
  switch (role) {
    case UserRole.ADMIN:
      return 'Administrator'
    case UserRole.MODERATOR:
      return 'Moderator'
    default:
      return 'Użytkownik'
  }
}
