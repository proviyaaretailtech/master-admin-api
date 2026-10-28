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

let rejectedRequests = 0;
/** Requests the gate has refused since start (no key, or a key no server is configured with). */
export const rejectedInternalKeyCount = () => rejectedRequests;

/** The gate runs before the rate limiter, so its log is throttled: one line per IP and reason per window. */
const LOG_WINDOW_MS = 60_000;
/** Most (IP, reason) windows held at once; past this, all callers share one window so memory stays bounded. */
const MAX_LOG_WINDOWS = 1_000;
/** Most refusal lines per window across all callers, so many distinct IPs cannot multiply the volume. */
const MAX_LINES_PER_WINDOW = 30;
const MAX_LOGGED_PATH = 100;

/**
 * Gate in front of every route: the request must carry one of our servers' keys. Open paths (liveness
 * only) are the exception. On success `req.internalCaller` names the server, and when that server
 * passes the browser's IP, `req.ip` becomes it, so the per-IP rate limiters count each person instead
 * of the one proxy all of them come through.
 *
 * Each refusal is counted and logged as "missing key" or "unknown key" with the connecting IP, so a
 * server with a wrong or stale key shows up in the logs. The line never carries the key or its digest.
 * Logging is throttled to one line per IP and reason per minute (the next line says how many were
 * suppressed), capped at 30 lines a minute in all, and the path is cut short, so an anonymous flood cannot
 * fill the logs; the count is exact. `req.ip` comes from X-Forwarded-For when trust proxy is on, so it is
 * logged and keyed on only when it parses as an IP; anything else is "invalid ip".
 */
export function requireInternalKey(options: {
  openPaths: string[];
  keys?: InternalKey[];
  log?: (line: string) => void;
  logWindowMs?: number;
  maxLinesPerWindow?: number;
  now?: () => number;
}) {
  const keys = options.keys ?? internalKeysFromEnv(process.env);
  const log = options.log ?? ((line: string) => console.warn(line));
  const windowMs = options.logWindowMs ?? LOG_WINDOW_MS;
  const now = options.now ?? Date.now;
  const maxLines = options.maxLinesPerWindow ?? MAX_LINES_PER_WINDOW;
  const open = new Set(options.openPaths);
  const windows = new Map<string, { start: number; suppressed: number }>();
  /** All callers together: lines written this window, and lines dropped by the cap since the last line. */
  const overall = { start: -Infinity, lines: 0, dropped: 0 };

  /** Returns how many lines were suppressed for this key in its last window, or null to stay quiet now. */
  function admitLogLine(key: string): number | null {
    const t = now();
    if (!windows.has(key) && windows.size >= MAX_LOG_WINDOWS) {
      for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
      if (windows.size >= MAX_LOG_WINDOWS) key = "*";
    }
    const w = windows.get(key);
    if (w && t - w.start < windowMs) {
      w.suppressed += 1;
      return null;
    }
    windows.set(key, { start: t, suppressed: 0 });
    return w?.suppressed ?? 0;
  }

  /** The overall cap. Returns how many lines it dropped since the last one written, or null when over it. */
  function admitOverall(): number | null {
    const t = now();
    if (t - overall.start >= windowMs) {
      overall.start = t;
      overall.lines = 0;
    }
    if (overall.lines >= maxLines) {
      overall.dropped += 1;
      return null;
    }
    overall.lines += 1;
    const dropped = overall.dropped;
    overall.dropped = 0;
    return dropped;
  }

  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === "GET" && open.has(req.path.replace(/\/+$/, ""))) {
      next();
      return;
    }
    const presented = req.get(INTERNAL_KEY_HEADER);
    const caller = identifyCaller(presented, keys);
    if (!caller) {
      rejectedRequests += 1;
      const reason = presented ? "unknown key" : "missing key";
      const ip = req.ip && isIP(req.ip) ? req.ip : "invalid ip";
      const suppressed = admitLogLine(`${reason}|${ip}`);
      const dropped = suppressed === null ? null : admitOverall();
      if (suppressed !== null && dropped !== null) {
        const path =
          req.path.length > MAX_LOGGED_PATH ? `${req.path.slice(0, MAX_LOGGED_PATH)}...` : req.path;
        const notes = [
          suppressed ? `${suppressed} similar not logged` : "",
          dropped ? `${dropped} from other callers not logged` : "",
        ].filter(Boolean);
        log(
          `[internal-key] 401 ${reason} from ${ip} on ${req.method} ${path} ` +
            `(rejected so far: ${rejectedRequests}${notes.map((n) => `; ${n}`).join("")})`
        );
      }
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

/** Lets only the named servers through (staff routes: admin-frontend; /internal/*: the app servers). */
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
