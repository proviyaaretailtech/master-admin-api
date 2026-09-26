import { Router } from "express";
import { healthCheckController } from "../controllers/health.controller";

const healthRoutes = Router();

healthRoutes.get("/", healthCheckController);

export default healthRoutes;
