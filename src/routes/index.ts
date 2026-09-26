import { Router } from "express";
import healthRoutes from "./health.route";
import authRoutes from "./auth.route";
import userRoutes from "./user.route";
import organizationRoutes from "./organization.route";
import locationRoutes from "./location.route";

const router = Router();

// Organization locations route
router.use("/organizations/:org_id/locations", locationRoutes);

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/organizations", organizationRoutes);

export default router;
