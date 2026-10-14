import { CookieOptions, Request, Response } from "express";
import { Env } from "../config/env.config";

/**
 * The Supabase refresh token lives in an httpOnly cookie, never in the browser's script-readable storage:
 * page scripts (and so an XSS payload) cannot read it, and it is only ever sent to the auth endpoints.
 *  - HttpOnly: invisible to JavaScript.
 *  - SameSite=Strict: never sent on a cross-site request, so another site cannot make the browser refresh
 *    (the origin guard in index.ts refuses foreign origins as well).
 *  - Secure outside local development/tests (browsers drop Secure cookies on plain-http localhost).
 *  - Path = <BASE_PATH>/auth: not attached to any other API call.
 * The app is served same-origin (Vercel rewrites /api, Vite proxies /api in development), which is what
 * SameSite=Strict needs.
 */
export const REFRESH_COOKIE = "ma_refresh";
/** An admin idle for longer than this signs in again even though Supabase would still honour the token. */
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: Env.NODE_ENV === "production",
    path: `${Env.BASE_PATH.replace(/\/+$/, "")}/auth`,
  };
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(),
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

/** Reads the refresh cookie from the raw Cookie header (no cookie-parser dependency needed for one value). */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      const value = decodeURIComponent(raw);
      return value.length > 0 && value.length <= 4096 ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
