import { Router } from "express";
import {
  createLocationController,
  getLocationsController,
  getLocationByIdController,
  updateLocationController,
  deleteLocationController,
} from "../controllers/location.controller";

// mergeParams: true ensures :org_id from parent route is accessible in this sub-router
const locationRoutes = Router({ mergeParams: true });

locationRoutes.post("/", createLocationController);
locationRoutes.get("/", getLocationsController);
locationRoutes.get("/:id", getLocationByIdController);
locationRoutes.put("/:id", updateLocationController);
locationRoutes.patch("/:id", updateLocationController);
locationRoutes.delete("/:id", deleteLocationController);

export default locationRoutes;
