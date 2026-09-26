import { Router } from "express";
import {
  createOrganizationController,
  getOrganizationsController,
  getOrganizationByIdController,
  updateOrganizationController,
  deleteOrganizationController,
} from "../controllers/organization.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const organizationRoutes = Router();

// Protect all organization CRUD routes with JWT authentication
organizationRoutes.use(requireAuth);

organizationRoutes.post("/", createOrganizationController);
organizationRoutes.get("/", getOrganizationsController);
organizationRoutes.get("/:id", getOrganizationByIdController);
organizationRoutes.put("/:id", updateOrganizationController);
organizationRoutes.patch("/:id", updateOrganizationController);
organizationRoutes.delete("/:id", deleteOrganizationController);

export default organizationRoutes;
