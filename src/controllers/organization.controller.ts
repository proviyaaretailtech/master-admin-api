import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { organizationService } from "../services/organization.service";
import {
  updateOrganizationSchema,
  getOrganizationsQuerySchema,
  organizationIdParamSchema,
} from "../validators/organization.validator";
import { HTTPSTATUS } from "../config/http.config";

/**
 * GET /api/organizations
 * Retrieves paginated organizations with search and filtering
 */
export const getOrganizationsController = asyncHandler(async (req: Request, res: Response) => {
  const query = getOrganizationsQuerySchema.parse(req.query);
  const result = await organizationService.getOrganizations(query);

  res.status(HTTPSTATUS.OK).json({
    message: "Organizations fetched successfully",
    organizations: result.organizations,
    pagination: result.pagination,
  });
});

/**
 * GET /api/organizations/:id
 * Retrieves a single organization by UUID
 */
export const getOrganizationByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = organizationIdParamSchema.parse(req.params);
  const organization = await organizationService.getOrganizationById(id);

  res.status(HTTPSTATUS.OK).json({
    message: "Organization fetched successfully",
    organization,
  });
});

/**
 * PUT / PATCH /api/organizations/:id
 * Updates an existing organization by UUID
 */
export const updateOrganizationController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = organizationIdParamSchema.parse(req.params);
  const body = updateOrganizationSchema.parse(req.body);
  const updatedOrganization = await organizationService.updateOrganization(id, body);

  res.status(HTTPSTATUS.OK).json({
    message: "Organization updated successfully",
    organization: updatedOrganization,
  });
});

/**
 * DELETE /api/organizations/:id
 * Deletes an organization by UUID
 */
export const deleteOrganizationController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = organizationIdParamSchema.parse(req.params);
  const result = await organizationService.deleteOrganization(id);

  res.status(HTTPSTATUS.OK).json(result);
});
