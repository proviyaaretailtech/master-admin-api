import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { Env } from "./config/env.config";
import {
  helmetSecurityMiddleware,
  globalRateLimiter,
  isCorsOriginAllowed,
  parseTrustProxy,
} from "./config/security.config";
import { errorHandler } from "./middlewares/errorHandler.middleware";
import { ForbiddenException, NotFoundException } from "./utils/app-error";
import apiRoutes from "./routes";
import { requireInternalKey } from "./middlewares/internal-key.middleware";

const app = express();

// 0. Behind a reverse proxy (Vercel) the client IP must come from the proxy hop, otherwise every
// request shares the proxy's IP and the rate limiters below become one global bucket (lock-out risk).
const trustedProxyHops = parseTrustProxy(Env.TRUST_PROXY);
app.set("trust proxy", trustedProxyHops);
app.disable("x-powered-by");

// 1. Security HTTP Headers
app.use(helmetSecurityMiddleware);

// 1b. Only our own servers may call the Master server: each sends its own key (x-internal-key).
// Browsers never reach this server; they go through their app's server. Liveness stays open.
app.use(requireInternalKey({ openPaths: [`${Env.BASE_PATH.replace(/\/+$/, "")}/health`] }));

// 2. Global Rate Limiter
app.use(globalRateLimiter);

// 3. Strict CORS Origin Policy: exact allow-list (CLIENT_ORIGIN) plus the API's own origin. A browser
// origin that is not allowed is refused outright (403); requests without an Origin (curl, server to
// server) are unaffected. Credentials are only ever offered to allowed origins.
const requestHost = (req: Request): string | undefined =>
  (trustedProxyHops > 0 ? req.get("x-forwarded-host") : undefined) || req.get("host") || undefined;
app.use((req: Request, _res: Response, next: NextFunction) => {
  const origin = req.get("origin");
  if (origin && !isCorsOriginAllowed(origin, requestHost(req))) {
    next(new ForbiddenException("This origin is not allowed to call the API"));
    return;
  }
  next();
});
app.use(cors({ origin: true, credentials: true }));

// 4. Strict Payload and Body Size Limits (Prevents JSON payload bomb / DoS attacks)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// 5. Base Health & Info Route
app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "Proviyaa Master Backend API is running",
    version: "1.0.0",
    healthCheck: `${Env.BASE_PATH}/health`,
  });
});

// 6. Strict rate limiting on login is applied inside routes/auth.route.ts (login only).

// 7. API Routes
app.use(Env.BASE_PATH, apiRoutes);

// 8. Fallback 404 Route
app.use((_req: Request, _res: Response) => {
  throw new NotFoundException("Route not found");
});

// 9. Global Error Handler Middleware
app.use(errorHandler);

// Start server only when not running in test mode and not inside Vercel serverless environment
if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
  app.listen(Env.PORT, () => {
    console.log(`🚀 Server running on port ${Env.PORT} in ${Env.NODE_ENV} mode`);
    console.log(`📡 API endpoint: http://localhost:${Env.PORT}${Env.BASE_PATH}`);
  });
}
// Support both CommonJS (Vercel Node Lambda handler) and ES module imports
if (typeof module !== "undefined" && module.exports) {
  module.exports = app;
  module.exports.default = app;
}

export default app;
