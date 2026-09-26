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
 * Strict Auth rate limiter (prevents brute-force attacks on login/signup)
 * Limits each IP to 10 authentication requests per 15 minutes window
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
 * Allowed CORS origins list
 */
export const allowedCorsOrigins = [
  Env.CLIENT_ORIGIN,
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
].filter(Boolean);
