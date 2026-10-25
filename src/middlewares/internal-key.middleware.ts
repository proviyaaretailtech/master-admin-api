import { isIP } from "node:net";
import { NextFunction, Request, Response } from "express";
import {
  InternalCaller,
  InternalKey,
  identifyCaller,
  internalKeysFromEnv,
} from "../config/internal-keys.config";
import { ForbiddenException, UnauthorizedException } from "../utils/app-error";

export const INTERNAL_KEY_HEADER = "x-internal-key";
/** The browser's IP as seen by the calling server. Trusted only on a request with a valid key. */
export const CLIENT_IP_HEADER = "x-client-ip";

/**
 * Gate in front of every route: the request must carry one of our servers' keys. Open paths (liveness
 * only) are the exception. On success `req.internalCaller` names the server, and when that server
 * passes the browser's IP, `req.ip` becomes it, so the per-IP rate limiters count each person instead
 * of the one proxy all of them come through.
 */
export function requireInternalKey(options: { openPaths: string[]; keys?: InternalKey[] }) {
  const keys = options.keys ?? internalKeysFromEnv(process.env);
  const open = new Set(options.openPaths);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === "GET" && open.has(req.path.replace(/\/+$/, ""))) {
      next();
      return;
    }
    const caller = identifyCaller(req.get(INTERNAL_KEY_HEADER), keys);
    if (!caller) {
      next(new UnauthorizedException("Unauthorized"));
      return;
    }
    req.internalCaller = caller;
    const clientIp = (req.get(CLIENT_IP_HEADER) || "").trim();
    if (clientIp && isIP(clientIp)) {
      Object.defineProperty(req, "ip", { value: clientIp, configurable: true });
    }
    next();
  };
}

/** Lets only the named servers through (staff routes: admin-web; /internal/*: the app servers). */
export function allowCallers(...callers: InternalCaller[]) {
  const allowed = new Set(callers);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.internalCaller && allowed.has(req.internalCaller)) {
      next();
      return;
    }
    next(new ForbiddenException("This server may not call this route"));
  };
}
