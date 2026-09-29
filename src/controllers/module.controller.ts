import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { moduleService } from "../services/module.service";
import {
  createModuleSchema,
  updateModuleSchema,
  moduleParamsSchema,
} from "../validators/module.validator";
import { HTTPSTATUS } from "../config/http.config";

/**
 * GET /api/commercials/modules
 * Lists all platform modules
 */
export const getModulesController = asyncHandler(async (_req: Request, res: Response) => {
  const modules = await moduleService.getAll();

  res.status(HTTPSTATUS.OK).json({
    message: "Platform modules retrieved successfully",
    modules,
  });
});

/**
 * GET /api/commercials/modules/:id
 * Retrieves a single platform module
 */
export const getModuleByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = moduleParamsSchema.parse(req.params);
  const moduleItem = await moduleService.getById(id);

  res.status(HTTPSTATUS.OK).json({
    message: "Platform module retrieved successfully",
    module: moduleItem,
  });
});

/**
 * POST /api/commercials/modules
 * Creates a new platform module
 */
export const createModuleController = asyncHandler(async (req: Request, res: Response) => {
  const body = createModuleSchema.parse(req.body);
  const moduleItem = await moduleService.create(body);

  res.status(HTTPSTATUS.CREATED).json({
    message: "Platform module created successfully",
    module: moduleItem,
  });
});

/**
 * PUT /api/commercials/modules/:id
 * Updates an existing platform module
 */
export const updateModuleController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = moduleParamsSchema.parse(req.params);
  const body = updateModuleSchema.parse(req.body);
  const moduleItem = await moduleService.update(id, body);

  res.status(HTTPSTATUS.OK).json({
    message: "Platform module updated successfully",
    module: moduleItem,
  });
});

/**
 * DELETE /api/commercials/modules/:id
 * Deletes a platform module
 */
export const deleteModuleController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = moduleParamsSchema.parse(req.params);
  await moduleService.delete(id);

  res.status(HTTPSTATUS.OK).json({
    message: "Platform module deleted successfully",
    id,
  });
});
