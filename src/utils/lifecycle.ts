import { Actor, actorCan } from "./authz";
import { ForbiddenException } from "./app-error";

/**
 * Lifecycle guard for plans, feature packs and add-ons.
 *
 * Draft -> Published and * -> Retired are privileged transitions with their own permission actions
 * (publish_* / retire_*), separate from the edit_* action. The `status` field is accepted on create and
 * update (the editor UI sends it) but is only ever honoured when the actor holds the matching action:
 * it can never be used to publish or retire through an edit-only permission. Changing the live terms of
 * an already Published item (price, limits, modules, ...) also needs the publish action, since it
 * re-prices or re-scopes the offer for every subscriber at once.
 */
export type CommercialStatus = "Draft" | "Published" | "Retired";

export interface LifecycleConfig {
  featureId: string;
  publishAction: string;
  retireAction: string;
  noun: string; // "plan", "pack", "add-on"
}

export const PLAN_LIFECYCLE: LifecycleConfig = {
  featureId: "feat_commercial_plans",
  publishAction: "publish_plan",
  retireAction: "retire_plan",
  noun: "plan",
};
export const PACK_LIFECYCLE: LifecycleConfig = {
  featureId: "feat_commercial_packs",
  publishAction: "publish_pack",
  retireAction: "retire_pack",
  noun: "pack",
};
export const ADDON_LIFECYCLE: LifecycleConfig = {
  featureId: "feat_commercial_addons",
  publishAction: "publish_addon",
  retireAction: "retire_addon",
  noun: "add-on",
};

function requireAction(actor: Actor, cfg: LifecycleConfig, action: string, verb: string): void {
  if (!actorCan(actor, cfg.featureId, action)) {
    throw new ForbiddenException(
      `Access Denied: ${verb} a ${cfg.noun} requires the '${action}' permission (the edit permission is not enough)`
    );
  }
}

/** Status a NEW item may be created with. Anything other than Draft needs the matching lifecycle action. */
export function authorizeCreateStatus(
  actor: Actor,
  requested: CommercialStatus | undefined,
  cfg: LifecycleConfig
): CommercialStatus {
  const status = requested ?? "Draft";
  if (status === "Published") requireAction(actor, cfg, cfg.publishAction, "Publishing");
  if (status === "Retired") requireAction(actor, cfg, cfg.retireAction, "Retiring");
  return status;
}

/**
 * Status to apply on an update, or undefined for "leave it". Moving to Published / Retired needs the
 * lifecycle action. A request for Draft on an item that is already published or retired is ignored
 * (the editor sends status "Draft" on every save): there is no way back to Draft through an edit.
 */
export function resolveUpdateStatus(
  actor: Actor,
  current: CommercialStatus,
  requested: CommercialStatus | undefined,
  cfg: LifecycleConfig
): CommercialStatus | undefined {
  if (requested === undefined || requested === current) return undefined;
  if (requested === "Published") {
    requireAction(actor, cfg, cfg.publishAction, "Publishing");
    return "Published";
  }
  if (requested === "Retired") {
    requireAction(actor, cfg, cfg.retireAction, "Retiring");
    return "Retired";
  }
  return undefined;
}

/** Editing a Published item changes live terms for every subscriber: it needs the publish action too. */
export function assertLiveEditAllowed(
  actor: Actor,
  current: CommercialStatus,
  hasFieldEdits: boolean,
  cfg: LifecycleConfig
): void {
  if (current === "Published" && hasFieldEdits && !actorCan(actor, cfg.featureId, cfg.publishAction)) {
    throw new ForbiddenException(
      `Access Denied: this ${cfg.noun} is Published, so changing it affects every subscriber and requires the '${cfg.publishAction}' permission`
    );
  }
}
