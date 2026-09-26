import { Router } from "express";
import {
  getUsersController,
  getUserByIdController,
  updateUserController,
  deleteUserController,
} from "../controllers/user.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const userRoutes = Router();

// Protect all user CRUD routes with custom JWT verification
userRoutes.use(requireAuth);

userRoutes.get("/", getUsersController);
userRoutes.get("/:id", getUserByIdController);
userRoutes.put("/:id", updateUserController);
userRoutes.delete("/:id", deleteUserController);

export default userRoutes;
