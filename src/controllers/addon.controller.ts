import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { HTTPSTATUS } from "../config/http.config";
import {
  addonParamsSchema,
  createAddonSchema,
  updateAddonSchema,
  getAddonsQuerySchema,
} from "../validators/addon.validator";
import { addonService } from "../services/addon.service";

/**
 * GET /api/commercials/add-ons
 */
export const getAddonsController = asyncHandler(async (req: Request, res: Response) => {
  const query = getAddonsQuerySchema.parse(req.query);
  const result = await addonService.getAddons(query);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial add-ons retrieved successfully",
    addons: result.addons,
    total: result.total,
  });
});

/**
 * GET /api/commercials/add-ons/categories
 */
export const getCategoriesController = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await addonService.getCategories();

  res.status(HTTPSTATUS.OK).json({
    message: "Add-on categories retrieved successfully",
    categories,
  });
});

/**
 * GET /api/commercials/add-ons/:id
 */
export const getAddonByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = addonParamsSchema.parse(req.params);
  const addon = await addonService.getAddonById(id);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial add-on retrieved successfully",
    addon,
  });
});

/**
 * POST /api/commercials/add-ons
 */
export const createAddonController = asyncHandler(async (req: Request, res: Response) => {
  const body = createAddonSchema.parse(req.body);
  const addon = await addonService.createAddon(body, req.user?.id);

  res.status(HTTPSTATUS.CREATED).json({
    message: "Commercial add-on created successfully",
    addon,
  });
});

/**
 * PUT /api/commercials/add-ons/:id
 */
export const updateAddonController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = addonParamsSchema.parse(req.params);
  const body = updateAddonSchema.parse(req.body);
  const addon = await addonService.updateAddon(id, body, req.user?.id);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial add-on updated successfully",
    addon,
  });
});

/**
 * POST /api/commercials/add-ons/:id/publish
 */
export const publishAddonController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = addonParamsSchema.parse(req.params);
  const addon = await addonService.publishAddon(id, req.user?.id);

  res.status(HTTPSTATUS.OK).json({
    message: `Commercial add-on '${addon.name}' published successfully`,
    addon,
  });
});

/**
 * POST /api/commercials/add-ons/:id/retire
 */
export const retireAddonController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = addonParamsSchema.parse(req.params);
  const addon = await addonService.retireAddon(id, req.user?.id);

  res.status(HTTPSTATUS.OK).json({
    message: `Commercial add-on '${addon.name}' retired successfully`,
    addon,
  });
});

/**
 * DELETE /api/commercials/add-ons/:id
 */
export const deleteAddonController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = addonParamsSchema.parse(req.params);
  const result = await addonService.deleteAddon(id);

  res.status(HTTPSTATUS.OK).json(result);
});
