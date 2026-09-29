import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { registerSchema, loginSchema } from "../validators/auth.validator";
import { authService } from "../services/auth.service";
import { HTTPSTATUS } from "../config/http.config";
import { UnauthorizedException } from "../utils/app-error";

export const registerController = asyncHandler(async (req: Request, res: Response) => {
  const body = registerSchema.parse(req.body);
  const result = await authService.register(body);

  res.status(HTTPSTATUS.CREATED).json({
    message: "User registered successfully",
    user: result.user,
    token: result.token,
  });
});

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);
  const result = await authService.login(body);

  res.status(HTTPSTATUS.OK).json({
    message: "Login successful",
    user: result.user,
    token: result.token,
  });
});

export const logoutController = asyncHandler(async (_req: Request, res: Response) => {
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
