import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { roleService } from "../services/role.service";
import {
  createRoleSchema,
  updateRoleSchema,
  getRolesQuerySchema,
  roleIdParamSchema,
} from "../validators/role.validator";
import { HTTPSTATUS } from "../config/http.config";

/**
 * GET /api/roles
 * Retrieves all security roles with search and scope filtering
 */
export const getRolesController = asyncHandler(async (req: Request, res: Response) => {
  const query = getRolesQuerySchema.parse(req.query);
  const result = await roleService.getRoles(query);

  res.status(HTTPSTATUS.OK).json({
    message: "Security roles fetched successfully",
    roles: result.roles,
    total: result.total,
  });
});

/**
 * GET /api/roles/:id
 * Retrieves a single role by UUID with hydrated feature permissions
 */
export const getRoleByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = roleIdParamSchema.parse(req.params);
  const role = await roleService.getRoleById(id);

  res.status(HTTPSTATUS.OK).json({
    message: "Security role fetched successfully",
    role,
  });
});

/**
 * POST /api/roles
 * Creates a new custom security role
 */
export const createRoleController = asyncHandler(async (req: Request, res: Response) => {
  const body = createRoleSchema.parse(req.body);
  const role = await roleService.createRole(body);

  res.status(HTTPSTATUS.CREATED).json({
    message: "Security role created successfully",
    role,
  });
});

/**
 * PUT /api/roles/:id
 * Updates an existing security role
 */
export const updateRoleController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = roleIdParamSchema.parse(req.params);
  const body = updateRoleSchema.parse(req.body);
  const role = await roleService.updateRole(id, body);

  res.status(HTTPSTATUS.OK).json({
    message: "Security role updated successfully",
    role,
  });
});

/**
 * DELETE /api/roles/:id
 * Permanently deletes a custom security role (blocks deletion of system roles)
 */
export const deleteRoleController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = roleIdParamSchema.parse(req.params);
  const result = await roleService.deleteRole(id);

  res.status(HTTPSTATUS.OK).json({
    message: `Security role '${result.name}' deleted successfully`,
    id: result.id,
  });
});
