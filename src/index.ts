import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Env } from "./config/env.config";
import { errorHandler } from "./middlewares/errorHandler.middleware";
import { NotFoundException } from "./utils/app-error";
import apiRoutes from "./routes";

const app = express();

// Middlewares
app.use(
  cors({
    origin: [Env.CLIENT_ORIGIN, "http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Base Route
app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "React + Supabase Backend API is running",
    version: "1.0.0",
    healthCheck: `${Env.BASE_PATH}/health`,
  });
});

// API Routes
app.use(Env.BASE_PATH, apiRoutes);

// Fallback 404 Route
app.use((_req: Request, _res: Response) => {
  throw new NotFoundException("Route not found");
});

// Global Error Handler Middleware
app.use(errorHandler);

const server = app.listen(Env.PORT, () => {
  console.log(`🚀 Server running on port ${Env.PORT} in ${Env.NODE_ENV} mode`);
  console.log(`📡 API endpoint: http://localhost:${Env.PORT}${Env.BASE_PATH}`);
});

export default app;
