import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { HTTPSTATUS } from "../config/http.config";
import { Env } from "../config/env.config";

export const healthCheckController = asyncHandler(async (_req: Request, res: Response) => {
  res.status(HTTPSTATUS.OK).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: Env.NODE_ENV,
    service: "React + Supabase Backend API",
  });
});
