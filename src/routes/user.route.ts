import { Router } from "express";
import {
  getUsersController,
  getUserByIdController,
  updateUserController,
  deleteUserController,
} from "../controllers/user.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";

const userRoutes = Router();

// Protect all user CRUD routes with custom JWT verification
userRoutes.use(requireAuth);

userRoutes.get(
  "/",
  requirePermission("feat_users_mgmt", "view_users", "read_only"),
  getUsersController
);

userRoutes.get(
  "/:id",
  requirePermission("feat_users_mgmt", "view_users", "read_only"),
  getUserByIdController
);

userRoutes.put(
  "/:id",
  requirePermission("feat_users_mgmt", "edit_user", "full"),
  updateUserController
);

userRoutes.delete(
  "/:id",
  requirePermission("feat_users_mgmt", "delete_user", "full"),
  deleteUserController
);

export default userRoutes;
