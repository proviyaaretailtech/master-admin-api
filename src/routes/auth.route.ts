import { Router } from "express";
import {
  loginController,
  logoutController,
  getMeController,
  refreshController,
  forgotPasswordController,
  resetPasswordController,
} from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import {
  authRateLimiter,
  refreshRateLimiter,
  forgotPasswordRateLimiter,
  resetPasswordRateLimiter,
} from "../config/security.config";

const authRoutes = Router();

// Brute-force protection: login has its own budget; refresh and password reset have theirs, so reading
// the profile (/auth/me) or logging out never consumes any of them.
authRoutes.post("/login", authRateLimiter, loginController);
authRoutes.post("/refresh", refreshRateLimiter, refreshController);
authRoutes.post("/logout", logoutController);
authRoutes.post("/forgot-password", forgotPasswordRateLimiter, forgotPasswordController);
authRoutes.post("/reset-password", resetPasswordRateLimiter, resetPasswordController);
authRoutes.get("/me", requireAuth, getMeController);

export default authRoutes;
