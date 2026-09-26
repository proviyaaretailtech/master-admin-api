import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { locationService } from "../services/location.service";
import {
  createLocationSchema,
  updateLocationSchema,
  getLocationsQuerySchema,
  locationParamsSchema,
} from "../validators/location.validator";
import { HTTPSTATUS } from "../config/http.config";

/**
 * POST /api/organisation/:org_id/locations
 * Creates a new location for an organization
 */
export const createLocationController = asyncHandler(async (req: Request, res: Response) => {
  const { org_id } = locationParamsSchema.parse(req.params);
  const body = createLocationSchema.parse(req.body);

  const location = await locationService.createLocation(org_id, body);

  res.status(HTTPSTATUS.CREATED).json({
    message: "Location created successfully",
    location,
  });
});

/**
 * GET /api/organisation/:org_id/locations
 * Retrieves all locations for an organization with optional search and pagination
 */
export const getLocationsController = asyncHandler(async (req: Request, res: Response) => {
  const { org_id } = locationParamsSchema.parse(req.params);
  const query = getLocationsQuerySchema.parse(req.query);

  const result = await locationService.getLocations(org_id, query);

  res.status(HTTPSTATUS.OK).json({
    message: "Locations fetched successfully",
    locations: result.locations,
    organization: result.organization,
    pagination: result.pagination,
  });
});

/**
 * GET /api/organisation/:org_id/locations/:id
 * Retrieves a single location by ID under an organization
 */
export const getLocationByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { org_id, id } = locationParamsSchema.parse(req.params);

  const location = await locationService.getLocationById(org_id, id!);

  res.status(HTTPSTATUS.OK).json({
    message: "Location fetched successfully",
    location,
  });
});

/**
 * PUT / PATCH /api/organisation/:org_id/locations/:id
 * Updates an existing location under an organization
 */
export const updateLocationController = asyncHandler(async (req: Request, res: Response) => {
  const { org_id, id } = locationParamsSchema.parse(req.params);
  const body = updateLocationSchema.parse(req.body);

  const location = await locationService.updateLocation(org_id, id!, body);

  res.status(HTTPSTATUS.OK).json({
    message: "Location updated successfully",
    location,
  });
});

/**
 * DELETE /api/organisation/:org_id/locations/:id
 * Deletes a location under an organization
 */
export const deleteLocationController = asyncHandler(async (req: Request, res: Response) => {
  const { org_id, id } = locationParamsSchema.parse(req.params);

  await locationService.deleteLocation(org_id, id!);

  res.status(HTTPSTATUS.OK).json({
    message: "Location deleted successfully",
  });
});
