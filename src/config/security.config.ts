import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { Env } from "./env.config";

/**
 * Helmet HTTP security headers configuration
 */
export const helmetSecurityMiddleware = helmet({
  contentSecurityPolicy: Env.NODE_ENV === "production" ? undefined : false,
  crossOriginEmbedderPolicy: false,
});

/**
 * Global API rate limiter (prevents DDoS and resource exhaustion)
 * Limits each IP to 200 requests per 15 minutes window
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    status: 429,
    error: "TooManyRequestsException",
    message: "Too many requests from this IP, please try again after 15 minutes.",
  },
});

/**
 * Strict Auth rate limiter (prevents brute-force attacks on login).
 * Limits each IP to 15 login attempts per 15 minutes window. It is mounted on POST /auth/login only:
 * reading the profile (/auth/me) or logging out must not consume the login budget.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error: "TooManyRequestsException",
    message: "Too many authentication attempts. Please try again after 15 minutes.",
  },
});

/**
 * How many reverse-proxy hops to trust when reading the client IP (`req.ip`). Without this behind a
 * proxy every request appears to come from the proxy, so all admins would share one rate-limit bucket.
 * Accepts a non-negative hop count. `true` is refused: trusting every X-Forwarded-For entry lets any
 * client pick its own IP and bypass the limiter.
 */
export function parseTrustProxy(value: string | undefined): number {
  const raw = (value ?? "0").trim().toLowerCase();
  if (raw === "" || raw === "false") return 0;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error(`TRUST_PROXY must be a hop count between 0 and 10 (got '${value}')`);
  }
  return hops;
}

/**
 * Allowed cross-origin browser origins: the comma separated CLIENT_ORIGIN list (exact match, no
 * wildcards - a "*.vercel.app" rule would trust every site hosted on that platform), plus the local
 * development origins when not in production. The API's own origin is always allowed (see
 * isCorsOriginAllowed).
 */
export const LOCAL_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
];

export function buildAllowedCorsOrigins(clientOrigin: string, nodeEnv: string): string[] {
  const configured = clientOrigin
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const list = nodeEnv === "production" ? configured : [...configured, ...LOCAL_DEV_ORIGINS];
  return Array.from(new Set(list));
}

export const allowedCorsOrigins = buildAllowedCorsOrigins(Env.CLIENT_ORIGIN, Env.NODE_ENV);

/**
 * True for requests without an Origin header (non-browser clients), for an exact match with the
 * allow-list, and for same-origin browser requests (Origin host equals the Host the API was reached on:
 * browsers send an Origin on same-origin POST/PUT/DELETE too).
 */
export function isCorsOriginAllowed(
  origin: string | undefined,
  requestHost: string | undefined,
  allowed: string[] = allowedCorsOrigins
): boolean {
  if (!origin) return true;
  if (allowed.includes(origin.replace(/\/+$/, ""))) return true;
  if (requestHost) {
    try {
      if (new URL(origin).host.toLowerCase() === requestHost.toLowerCase()) return true;
    } catch {
      return false;
    }
  }
  return false;
}
