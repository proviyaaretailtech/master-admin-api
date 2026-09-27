import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { registerSchema, loginSchema } from "../validators/auth.validator";
import { authService } from "../services/auth.service";
import { HTTPSTATUS } from "../config/http.config";
import { UnauthorizedException } from "../utils/app-error";

export const registerController = asyncHandler(async (req: Request, res: Response) => {
  const body = registerSchema.parse(req.body);
  const result = await authService.register(body);

  // Set httpOnly cookie if desired
  res.cookie("token", result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(HTTPSTATUS.CREATED).json({
    message: "User registered successfully",
    user: result.user,
    token: result.token,
  });
});

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);
  const result = await authService.login(body);

  // Set httpOnly cookie if desired
  res.cookie("token", result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(HTTPSTATUS.OK).json({
    message: "Login successful",
    user: result.user,
    token: result.token,
  });
});

export const logoutController = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie("token");
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

export const getPermissionsController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedException("Not authenticated");
  }

  const user = await authService.getMe(req.user);

  res.status(HTTPSTATUS.OK).json({
    message: "User permissions fetched successfully",
    permissions: user.permissions || [],
    role: user.role_details || null,
    isSuperAdmin:
      req.isSuperAdmin ??
      user.isSuperAdmin ??
      (user.role_details?.key === "super_admin"),
  });
});

