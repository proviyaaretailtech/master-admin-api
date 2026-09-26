import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { userService } from "../services/user.service";
import { updateUserSchema, getUsersQuerySchema } from "../validators/user.validator";
import { HTTPSTATUS } from "../config/http.config";

export const getUsersController = asyncHandler(async (req: Request, res: Response) => {
  const query = getUsersQuerySchema.parse(req.query);
  const result = await userService.getUsers(query);

  res.status(HTTPSTATUS.OK).json({
    message: "Users fetched successfully",
    users: result.users,
    pagination: result.pagination,
  });
});

export const getUserByIdController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await userService.getUserById(id);

  res.status(HTTPSTATUS.OK).json({
    message: "User fetched successfully",
    user,
  });
});

export const updateUserController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = updateUserSchema.parse(req.body);
  const updatedUser = await userService.updateUser(id, body);

  res.status(HTTPSTATUS.OK).json({
    message: "User updated successfully",
    user: updatedUser,
  });
});

export const deleteUserController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await userService.deleteUser(id);

  res.status(HTTPSTATUS.OK).json(result);
});
