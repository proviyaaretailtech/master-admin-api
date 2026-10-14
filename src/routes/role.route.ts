import { Router } from "express";
import {
  getRolesController,
  getPermissionCatalogController,
  getRoleByIdController,
  createRoleController,
  updateRoleController,
  deleteRoleController,
} from "../controllers/role.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";

const roleRoutes = Router();

// Protect role management routes with JWT authentication
roleRoutes.use(requireAuth);

roleRoutes.get(
  "/",
  requirePermission("feat_roles_templates", "view_roles", "read_only"),
  getRolesController
);

// Registered before "/:id" so "catalog" is not taken for a role id.
roleRoutes.get(
  "/catalog",
  requirePermission("feat_roles_templates", "view_roles", "read_only"),
  getPermissionCatalogController
);

roleRoutes.get(
  "/:id",
  requirePermission("feat_roles_templates", "view_roles", "read_only"),
  getRoleByIdController
);

roleRoutes.post(
  "/",
  requirePermission("feat_roles_templates", "create_roles", "full"),
  createRoleController
);

roleRoutes.put(
  "/:id",
  requirePermission("feat_roles_templates", "edit_roles", "full"),
  updateRoleController
);

roleRoutes.patch(
  "/:id",
  requirePermission("feat_roles_templates", "edit_roles", "full"),
  updateRoleController
);

roleRoutes.delete(
  "/:id",
  requirePermission("feat_roles_templates", "delete_roles", "full"),
  deleteRoleController
);

export default roleRoutes;
