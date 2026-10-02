import { Router } from "express";
import {
  loginController,
  logoutController,
  getMeController,
} from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const authRoutes = Router();

authRoutes.post("/login", loginController);
authRoutes.post("/logout", logoutController);
authRoutes.get("/me", requireAuth, getMeController);

export default authRoutes;
