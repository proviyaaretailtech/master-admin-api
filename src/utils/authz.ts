import { UserModel } from "../@types/express";
import { FeaturePermission, permissionsBeyond } from "./permission-adapter";
import { ForbiddenException, UnauthorizedException } from "./app-error";

/**
 * The authenticated staff member performing an action, as the services need to know them. Services
 * take an Actor (never an optional user id) so authorization cannot be skipped by omission.
 */
export interface Actor {
  id: string;
  roleId: string | null;
  isSuperAdmin: boolean;
  permissions: FeaturePermission[];
}

/** Builds the Actor from the hydrated user that requireAuth attached to the request. */
export function toActor(user: UserModel | undefined): Actor {
  if (!user) {
    throw new UnauthorizedException("Authentication required to access this resource");
  }
  return {
    id: user.id,
    roleId: user.role_id ?? null,
    isSuperAdmin: user.isSuperAdmin === true,
    permissions: user.permissions ?? [],
  };
}

/** True when the actor may perform `action` on `featureId` at full access (super admins always may). */
export function actorCan(actor: Actor, featureId: string, action: string): boolean {
  if (actor.isSuperAdmin) return true;
  const feature = actor.permissions.find((f) => f.id === featureId);
  if (!feature || feature.accessLevel !== "full") return false;
  return !!feature.actions?.some((a) => a.key === action && a.enabled);
}

/**
 * Privilege-escalation guard: a non-super actor may only deal in permission sets that are a subset of
 * their own. Throws 403 naming what exceeds their rights; super admins are unrestricted.
 */
export function assertWithinActorPermissions(actor: Actor, target: FeaturePermission[], what: string): void {
  if (actor.isSuperAdmin) return;
  const beyond = permissionsBeyond(actor.permissions, target);
  if (beyond.length > 0) {
    throw new ForbiddenException(
      `Privilege Escalation Prevention: you cannot ${what} (it includes permissions you do not hold: ${beyond
        .slice(0, 5)
        .join(", ")}${beyond.length > 5 ? ", ..." : ""})`
    );
  }
}
