import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import {
  loginSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validators/auth.validator";
import { authService } from "../services/auth.service";
import { HTTPSTATUS } from "../config/http.config";
import { resolveFrontendOrigin } from "../config/security.config";
import { UnauthorizedException } from "../utils/app-error";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "../utils/refresh-cookie";

/** Same answer whether or not the address belongs to an administrator (no account enumeration). */
export const FORGOT_PASSWORD_RESPONSE =
  "If that email belongs to a Master Admin account, a password reset link is on its way.";

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);
  const result = await authService.login(body);

  // The refresh token goes into an httpOnly cookie only; the body carries the short-lived access token.
  if (result.refreshToken) setRefreshCookie(res, result.refreshToken);
  res.status(HTTPSTATUS.OK).json({
    message: "Login successful",
    user: result.user,
    token: result.token,
    expiresAt: result.expiresAt,
  });
});

/** POST /auth/refresh: new access token from the refresh cookie (rotated on every use). */
export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  try {
    const session = await authService.refresh(readRefreshCookie(req));
    if (session.refreshToken) setRefreshCookie(res, session.refreshToken);
    res.status(HTTPSTATUS.OK).json({
      message: "Session refreshed",
      token: session.token,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  // Revoke the caller's Supabase session (best effort; the response is the same either way so the
  // endpoint cannot be used to probe tokens). scope "global" = sign out everywhere.
  const { scope } = logoutSchema.parse(req.body ?? {});
  const header = req.headers.authorization;
  const token = header && header.startsWith("Bearer ") ? header.slice(7) : undefined;
  await authService.logout(token, scope);
  clearRefreshCookie(res);

  res.status(HTTPSTATUS.OK).json({
    message: "Logout successful",
  });
});

/** POST /auth/forgot-password: emails a reset link to an Active administrator; same answer for anyone. */
export const forgotPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  const redirectTo = `${resolveFrontendOrigin(req.get("origin"))}/reset-password`;
  await authService.requestPasswordReset(email, redirectTo);

  res.status(HTTPSTATUS.OK).json({ message: FORGOT_PASSWORD_RESPONSE });
});

/** POST /auth/reset-password: sets the new password with the recovery token from the emailed link. */
export const resetPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const body = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(body);
  clearRefreshCookie(res);

  res
    .status(HTTPSTATUS.OK)
    .json({ message: "Your password has been changed. Sign in with the new password." });
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
