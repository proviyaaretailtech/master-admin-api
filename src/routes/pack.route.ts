import { Router } from "express";
import {
  getPacksController,
  getPackByIdController,
  createPackController,
  updatePackController,
  publishPackController,
  retirePackController,
  deletePackController,
} from "../controllers/pack.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";

const packRoutes = Router();

// Protect all pack routes with authentication
packRoutes.use(requireAuth);

// GET /api/commercials/packs - List all packs (requires view_packs)
packRoutes.get(
  "/",
  requirePermission("feat_commercial_packs", "view_packs", "read_only"),
  getPacksController
);

// GET /api/commercials/packs/:id - Get pack by ID (requires view_packs)
packRoutes.get(
  "/:id",
  requirePermission("feat_commercial_packs", "view_packs", "read_only"),
  getPackByIdController
);

// POST /api/commercials/packs - Create a new pack (requires create_pack)
packRoutes.post(
  "/",
  requirePermission("feat_commercial_packs", "create_pack", "full"),
  createPackController
);

// PUT /api/commercials/packs/:id - Update pack (requires edit_pack)
packRoutes.put(
  "/:id",
  requirePermission("feat_commercial_packs", "edit_pack", "full"),
  updatePackController
);

// PATCH /api/commercials/packs/:id - Partial update pack (requires edit_pack)
packRoutes.patch(
  "/:id",
  requirePermission("feat_commercial_packs", "edit_pack", "full"),
  updatePackController
);

// POST /api/commercials/packs/:id/publish - Publish pack (requires publish_pack)
packRoutes.post(
  "/:id/publish",
  requirePermission("feat_commercial_packs", "publish_pack", "full"),
  publishPackController
);

// POST /api/commercials/packs/:id/retire - Retire pack (requires retire_pack)
packRoutes.post(
  "/:id/retire",
  requirePermission("feat_commercial_packs", "retire_pack", "full"),
  retirePackController
);

// DELETE /api/commercials/packs/:id - Delete draft pack (requires delete_pack)
packRoutes.delete(
  "/:id",
  requirePermission("feat_commercial_packs", "delete_pack", "full"),
  deletePackController
);

export default packRoutes;
