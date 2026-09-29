import { Router } from "express";
import {
  getPlansController,
  getPlanByIdController,
  createPlanController,
  updatePlanController,
  publishPlanController,
  duplicatePlanController,
  retirePlanController,
  deletePlanController,
} from "../controllers/plan.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";

const planRoutes = Router();

// Protect all plan routes with authentication
planRoutes.use(requireAuth);

// GET /api/commercials/plans - List all plans (requires view_plans)
planRoutes.get(
  "/",
  requirePermission("feat_commercial_plans", "view_plans", "read_only"),
  getPlansController
);

// GET /api/commercials/plans/:id - Get plan by ID (requires view_plans)
planRoutes.get(
  "/:id",
  requirePermission("feat_commercial_plans", "view_plans", "read_only"),
  getPlanByIdController
);

// POST /api/commercials/plans - Create a new plan (requires create_plan)
planRoutes.post(
  "/",
  requirePermission("feat_commercial_plans", "create_plan", "full"),
  createPlanController
);

// PUT /api/commercials/plans/:id - Update plan (requires edit_plan)
planRoutes.put(
  "/:id",
  requirePermission("feat_commercial_plans", "edit_plan", "full"),
  updatePlanController
);

// PATCH /api/commercials/plans/:id - Partial update plan (requires edit_plan)
planRoutes.patch(
  "/:id",
  requirePermission("feat_commercial_plans", "edit_plan", "full"),
  updatePlanController
);

// POST /api/commercials/plans/:id/publish - Publish plan (requires publish_plan)
planRoutes.post(
  "/:id/publish",
  requirePermission("feat_commercial_plans", "publish_plan", "full"),
  publishPlanController
);

// POST /api/commercials/plans/:id/duplicate - Duplicate plan (requires duplicate_plan)
planRoutes.post(
  "/:id/duplicate",
  requirePermission("feat_commercial_plans", "duplicate_plan", "full"),
  duplicatePlanController
);

// POST /api/commercials/plans/:id/retire - Retire plan (requires retire_plan)
planRoutes.post(
  "/:id/retire",
  requirePermission("feat_commercial_plans", "retire_plan", "full"),
  retirePlanController
);

// DELETE /api/commercials/plans/:id - Delete draft plan (requires retire_plan)
planRoutes.delete(
  "/:id",
  requirePermission("feat_commercial_plans", "retire_plan", "full"),
  deletePlanController
);

export default planRoutes;
