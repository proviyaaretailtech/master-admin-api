import { Router } from "express";
import {
  createOrganizationController,
  getOrganizationsController,
  getOrganizationByIdController,
  updateOrganizationController,
  deleteOrganizationController,
} from "../controllers/organization.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import {
  requirePermission,
  requireAnyPermission,
  requireOrganizationUpdatePermission,
} from "../middlewares/permission.middleware";

const organizationRoutes = Router();

// Protect all organization CRUD routes with JWT authentication
organizationRoutes.use(requireAuth);

organizationRoutes.post(
  "/",
  requirePermission("feat_org_360", "create_org", "full"),
  createOrganizationController
);

organizationRoutes.get(
  "/",
  requirePermission("feat_org_360", "view_directory", "read_only"),
  getOrganizationsController
);

organizationRoutes.get(
  "/:id",
  requireAnyPermission([
    { featureId: "feat_org_360", action: "view_directory" },
    { featureId: "feat_partner_review" },
    { featureId: "feat_partner_locations", action: "view_locations" },
    { featureId: "feat_partner_docs", action: "view_docs" },
  ]),
  getOrganizationByIdController
);

organizationRoutes.put(
  "/:id",
  requireOrganizationUpdatePermission,
  updateOrganizationController
);

organizationRoutes.patch(
  "/:id",
  requireOrganizationUpdatePermission,
  updateOrganizationController
);

organizationRoutes.delete(
  "/:id",
  requirePermission("feat_partner_review", "delete_partner", "full"),
  deleteOrganizationController
);

export default organizationRoutes;

