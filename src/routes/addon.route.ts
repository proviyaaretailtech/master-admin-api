import { Router } from "express";
import {
  getAddonsController,
  getCategoriesController,
  getAddonByIdController,
  createAddonController,
  updateAddonController,
  publishAddonController,
  retireAddonController,
  deleteAddonController,
} from "../controllers/addon.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";

const addonRoutes = Router();

// Protect all addon routes with authentication
addonRoutes.use(requireAuth);

// GET /api/commercials/add-ons - List all add-ons (requires view_addons)
addonRoutes.get(
  "/",
  requirePermission("feat_commercial_addons", "view_addons", "read_only"),
  getAddonsController
);

// GET /api/commercials/add-ons/categories - List unique categories
addonRoutes.get(
  "/categories",
  requirePermission("feat_commercial_addons", "view_addons", "read_only"),
  getCategoriesController
);

// GET /api/commercials/add-ons/:id - Get add-on by ID (requires view_addons)
addonRoutes.get(
  "/:id",
  requirePermission("feat_commercial_addons", "view_addons", "read_only"),
  getAddonByIdController
);

// POST /api/commercials/add-ons - Create a new add-on (requires create_addon)
addonRoutes.post(
  "/",
  requirePermission("feat_commercial_addons", "create_addon", "full"),
  createAddonController
);

// PUT /api/commercials/add-ons/:id - Update add-on (requires edit_addon)
addonRoutes.put(
  "/:id",
  requirePermission("feat_commercial_addons", "edit_addon", "full"),
  updateAddonController
);

// PATCH /api/commercials/add-ons/:id - Partial update add-on (requires edit_addon)
addonRoutes.patch(
  "/:id",
  requirePermission("feat_commercial_addons", "edit_addon", "full"),
  updateAddonController
);

// POST /api/commercials/add-ons/:id/publish - Publish add-on (requires publish_addon)
addonRoutes.post(
  "/:id/publish",
  requirePermission("feat_commercial_addons", "publish_addon", "full"),
  publishAddonController
);

// POST /api/commercials/add-ons/:id/retire - Retire add-on (requires retire_addon)
addonRoutes.post(
  "/:id/retire",
  requirePermission("feat_commercial_addons", "retire_addon", "full"),
  retireAddonController
);

// DELETE /api/commercials/add-ons/:id - Delete draft add-on (requires delete_addon)
addonRoutes.delete(
  "/:id",
  requirePermission("feat_commercial_addons", "delete_addon", "full"),
  deleteAddonController
);

export default addonRoutes;
