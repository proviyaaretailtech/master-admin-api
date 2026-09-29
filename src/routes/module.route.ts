import { Router } from "express";
import {
  getModulesController,
  getModuleByIdController,
  createModuleController,
  updateModuleController,
  deleteModuleController,
} from "../controllers/module.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";

const moduleRoutes = Router();

// Protect all module routes with authentication
moduleRoutes.use(requireAuth);

// GET /api/commercials/modules - List all modules
moduleRoutes.get(
  "/",
  requirePermission("feat_commercial_plans", "view_plans", "read_only"),
  getModulesController
);

// GET /api/commercials/modules/:id - Get module by ID
moduleRoutes.get(
  "/:id",
  requirePermission("feat_commercial_plans", "view_plans", "read_only"),
  getModuleByIdController
);

// POST /api/commercials/modules - Create module (requires manage_modules)
moduleRoutes.post(
  "/",
  requirePermission("feat_commercial_plans", "manage_modules", "full"),
  createModuleController
);

// PUT /api/commercials/modules/:id - Update module (requires manage_modules)
moduleRoutes.put(
  "/:id",
  requirePermission("feat_commercial_plans", "manage_modules", "full"),
  updateModuleController
);

// DELETE /api/commercials/modules/:id - Delete module (requires manage_modules)
moduleRoutes.delete(
  "/:id",
  requirePermission("feat_commercial_plans", "manage_modules", "full"),
  deleteModuleController
);

export default moduleRoutes;
