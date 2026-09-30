import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { HTTPSTATUS } from "../config/http.config";
import {
  packParamsSchema,
  createPackSchema,
  updatePackSchema,
  getPacksQuerySchema,
} from "../validators/pack.validator";
import { packService } from "../services/pack.service";

/**
 * GET /api/commercials/packs
 */
export const getPacksController = asyncHandler(async (req: Request, res: Response) => {
  const query = getPacksQuerySchema.parse(req.query);
  const result = await packService.getPacks(query);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial packs retrieved successfully",
    packs: result.packs,
    total: result.total,
  });
});

/**
 * GET /api/commercials/packs/:id
 */
export const getPackByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = packParamsSchema.parse(req.params);
  const pack = await packService.getPackById(id);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial pack retrieved successfully",
    pack,
  });
});

/**
 * POST /api/commercials/packs
 */
export const createPackController = asyncHandler(async (req: Request, res: Response) => {
  const body = createPackSchema.parse(req.body);
  const pack = await packService.createPack(body, req.user?.id);

  res.status(HTTPSTATUS.CREATED).json({
    message: "Commercial pack created successfully",
    pack,
  });
});

/**
 * PUT /api/commercials/packs/:id
 */
export const updatePackController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = packParamsSchema.parse(req.params);
  const body = updatePackSchema.parse(req.body);
  const pack = await packService.updatePack(id, body, req.user?.id);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial pack updated successfully",
    pack,
  });
});

/**
 * POST /api/commercials/packs/:id/publish
 */
export const publishPackController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = packParamsSchema.parse(req.params);
  const pack = await packService.publishPack(id, req.user?.id);

  res.status(HTTPSTATUS.OK).json({
    message: `Commercial pack '${pack.name}' published successfully`,
    pack,
  });
});

/**
 * POST /api/commercials/packs/:id/retire
 */
export const retirePackController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = packParamsSchema.parse(req.params);
  const pack = await packService.retirePack(id, req.user?.id);

  res.status(HTTPSTATUS.OK).json({
    message: `Commercial pack '${pack.name}' retired successfully`,
    pack,
  });
});

/**
 * DELETE /api/commercials/packs/:id
 */
export const deletePackController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = packParamsSchema.parse(req.params);
  const result = await packService.deletePack(id);

  res.status(HTTPSTATUS.OK).json(result);
});
