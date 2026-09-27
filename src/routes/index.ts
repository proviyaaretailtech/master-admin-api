import { Router } from "express";
import healthRoutes from "./health.route";
import authRoutes from "./auth.route";
import userRoutes from "./user.route";
import organizationRoutes from "./organization.route";
import locationRoutes from "./location.route";
import roleRoutes from "./role.route";

const router = Router();

// Organization locations route
router.use("/organizations/:org_id/locations", locationRoutes);

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/organizations", organizationRoutes);
router.use("/roles", roleRoutes);
router.use("/security-roles", roleRoutes);

export default router;
