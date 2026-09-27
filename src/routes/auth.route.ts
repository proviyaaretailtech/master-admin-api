import { Router } from "express";
import {
  registerController,
  loginController,
  logoutController,
  getMeController,
  getPermissionsController,
} from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const authRoutes = Router();

authRoutes.post("/register", registerController);
authRoutes.post("/login", loginController);
authRoutes.post("/logout", logoutController);
authRoutes.get("/me", requireAuth, getMeController);
authRoutes.get("/permissions", requireAuth, getPermissionsController);

export default authRoutes;

