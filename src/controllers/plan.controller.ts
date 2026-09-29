import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { planService } from "../services/plan.service";
import {
  createPlanSchema,
  updatePlanSchema,
  getPlansQuerySchema,
  planParamsSchema,
} from "../validators/plan.validator";
import { HTTPSTATUS } from "../config/http.config";

/**
 * GET /api/commercials/plans
 * Lists all commercial plans with filters
 */
export const getPlansController = asyncHandler(async (req: Request, res: Response) => {
  const query = getPlansQuerySchema.parse(req.query);
  const result = await planService.getAll(query);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial plans retrieved successfully",
    plans: result.plans,
    total: result.total,
  });
});

/**
 * GET /api/commercials/plans/:id
 * Retrieves a single commercial plan by ID
 */
export const getPlanByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = planParamsSchema.parse(req.params);
  const plan = await planService.getById(id);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial plan retrieved successfully",
    plan,
  });
});

/**
 * POST /api/commercials/plans
 * Creates a new commercial plan
 */
export const createPlanController = asyncHandler(async (req: Request, res: Response) => {
  const body = createPlanSchema.parse(req.body);
  const userId = req.user?.id;

  const plan = await planService.create(body, userId);

  res.status(HTTPSTATUS.CREATED).json({
    message: "Commercial plan created successfully",
    plan,
  });
});

/**
 * PUT /api/commercials/plans/:id
 * Updates an existing commercial plan
 */
export const updatePlanController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = planParamsSchema.parse(req.params);
  const body = updatePlanSchema.parse(req.body);
  const userId = req.user?.id;

  const plan = await planService.update(id, body, userId);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial plan updated successfully",
    plan,
  });
});

/**
 * POST /api/commercials/plans/:id/publish
 * Publishes a draft plan to active status
 */
export const publishPlanController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = planParamsSchema.parse(req.params);
  const userId = req.user?.id;

  const plan = await planService.publish(id, userId);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial plan published successfully",
    plan,
  });
});

/**
 * POST /api/commercials/plans/:id/duplicate
 * Clones a plan into a new Draft copy
 */
export const duplicatePlanController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = planParamsSchema.parse(req.params);
  const userId = req.user?.id;

  const plan = await planService.duplicate(id, userId);

  res.status(HTTPSTATUS.CREATED).json({
    message: "Commercial plan duplicated successfully",
    plan,
  });
});

/**
 * POST /api/commercials/plans/:id/retire
 * Retires an active plan
 */
export const retirePlanController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = planParamsSchema.parse(req.params);
  const userId = req.user?.id;

  const plan = await planService.retire(id, userId);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial plan retired successfully",
    plan,
  });
});

/**
 * DELETE /api/commercials/plans/:id
 * Deletes a draft/unused plan
 */
export const deletePlanController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = planParamsSchema.parse(req.params);
  await planService.delete(id);

  res.status(HTTPSTATUS.OK).json({
    message: "Commercial plan deleted successfully",
    id,
  });
});
