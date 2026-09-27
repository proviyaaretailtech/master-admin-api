import { Router } from "express";
import {
  createLocationController,
  getLocationsController,
  getLocationByIdController,
  updateLocationController,
  deleteLocationController,
} from "../controllers/location.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";

// mergeParams: true ensures :org_id from parent route is accessible in this sub-router
const locationRoutes = Router({ mergeParams: true });

// Protect all organization locations routes with JWT authentication
locationRoutes.use(requireAuth);

locationRoutes.post(
  "/",
  requirePermission("feat_partner_locations", "create_location", "full"),
  createLocationController
);

locationRoutes.get(
  "/",
  requirePermission("feat_partner_locations", "view_locations", "read_only"),
  getLocationsController
);

locationRoutes.get(
  "/:id",
  requirePermission("feat_partner_locations", "view_locations", "read_only"),
  getLocationByIdController
);

locationRoutes.put(
  "/:id",
  requirePermission("feat_partner_locations", "edit_location", "full"),
  updateLocationController
);

locationRoutes.patch(
  "/:id",
  requirePermission("feat_partner_locations", "edit_location", "full"),
  updateLocationController
);

locationRoutes.delete(
  "/:id",
  requirePermission("feat_partner_locations", "delete_location", "full"),
  deleteLocationController
);

export default locationRoutes;

