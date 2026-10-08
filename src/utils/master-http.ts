import { Request, Response, Router, RequestHandler } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { requireAuth } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission, PermissionCheckOption } from "../middlewares/permission.middleware";
import { Actor, toActor } from "./authz";
import { mapDbError } from "./db-error";
import { AccessLevel } from "./permission-adapter";

/** Wraps a handler: async errors go to the error handler, database business errors are mapped to {message, errorCode}. */
export const wrap = (fn: (req: Request, res: Response, actor: Actor) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    try {
      await fn(req, res, toActor(req.user));
    } catch (err) {
      throw mapDbError(err);
    }
  });

/** A router that requires a signed-in staff member on every route. */
export function authedRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  return r;
}

export const can = (feature: string, action: string, level: AccessLevel = "read_only") => requirePermission(feature, action, level);
/** Write permission: full access level plus the action. */
export const canWrite = (feature: string, action: string) => requirePermission(feature, action, "full");
export const canAny = (opts: PermissionCheckOption[]) => requireAnyPermission(opts);
