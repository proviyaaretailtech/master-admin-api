import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { loginSchema } from "../validators/auth.validator";
import { authService } from "../services/auth.service";
import { HTTPSTATUS } from "../config/http.config";
import { UnauthorizedException } from "../utils/app-error";

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);
  const result = await authService.login(body);

  res.status(HTTPSTATUS.OK).json({
    message: "Login successful",
    user: result.user,
    token: result.token,
  });
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  // Revoke the caller's Supabase session (best effort; the response is the same either way so the
  // endpoint cannot be used to probe tokens).
  const header = req.headers.authorization;
  const token = header && header.startsWith("Bearer ") ? header.slice(7) : undefined;
  await authService.logout(token);

  res.status(HTTPSTATUS.OK).json({
    message: "Logout successful",
  });
});

export const getMeController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedException("Not authenticated");
  }

  const user = await authService.getMe(req.user);

  res.status(HTTPSTATUS.OK).json({
    message: "Current user profile fetched successfully",
    user,
  });
});
