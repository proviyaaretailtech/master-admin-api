import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { HTTPSTATUS } from "../config/http.config";

export const healthCheckController = asyncHandler(async (_req: Request, res: Response) => {
  // Unauthenticated: reveals liveness only (no environment name, uptime or versions).
  res.status(HTTPSTATUS.OK).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});
