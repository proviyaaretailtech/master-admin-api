import express, { Request, Response } from "express";
import cors from "cors";
import { Env } from "./config/env.config";
import {
  helmetSecurityMiddleware,
  globalRateLimiter,
  authRateLimiter,
  allowedCorsOrigins,
} from "./config/security.config";
import { errorHandler } from "./middlewares/errorHandler.middleware";
import { NotFoundException } from "./utils/app-error";
import apiRoutes from "./routes";

const app = express();

// 1. Security HTTP Headers
app.use(helmetSecurityMiddleware);

// 2. Global Rate Limiter
app.use(globalRateLimiter);

// 3. Strict CORS Origin Policy
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server) or Vercel preview/production domains
      if (!origin || allowedCorsOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
        callback(null, true);
      } else {
        callback(new Error(`CORS error: Origin ${origin} not allowed`));
      }
    },
    credentials: true,
  })
);

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

// 6. Strict Rate Limiting on Authentication Endpoints
app.use(`${Env.BASE_PATH}/auth`, authRateLimiter);

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

export default app;
