import { Router } from "express";
import healthRoutes from "./health.route";
import authRoutes from "./auth.route";
import userRoutes from "./user.route";
import organizationRoutes from "./organization.route";
import locationRoutes from "./location.route";
import roleRoutes from "./role.route";
import planRoutes from "./plan.route";
import moduleRoutes from "./module.route";
import packRoutes from "./pack.route";
import addonRoutes from "./addon.route";

const router = Router();

// Organization locations route
router.use("/organizations/:org_id/locations", locationRoutes);

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/organizations", organizationRoutes);
router.use("/roles", roleRoutes);
router.use("/security-roles", roleRoutes);
router.use("/commercials/plans", planRoutes);
router.use("/commercials/modules", moduleRoutes);
router.use("/commercials/packs", packRoutes);
router.use("/commercials/add-ons", addonRoutes);

export default router;
