import { Router } from "express";
import {
  loginController,
  logoutController,
  getMeController,
} from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { authRateLimiter } from "../config/security.config";

const authRoutes = Router();

// Brute-force protection applies to login only (not to /me or /logout).
authRoutes.post("/login", authRateLimiter, loginController);
authRoutes.post("/logout", logoutController);
authRoutes.get("/me", requireAuth, getMeController);

export default authRoutes;
