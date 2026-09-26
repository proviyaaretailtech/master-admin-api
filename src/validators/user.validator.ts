import { z } from "zod";

export const updateUserSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(2, "First name must be at least 2 characters")
    .max(100)
    .optional(),
  last_name: z.string().trim().min(1, "Last name cannot be empty").max(100).optional(),
  phone_number: z.string().trim().optional(),
  email: z.string().trim().email("Please provide a valid email address").toLowerCase().optional(),
  role: z.string().trim().max(50).optional(),
  panel: z.string().trim().max(50).optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

export const getUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(9),
  search: z.string().trim().optional(),
  panel: z.string().trim().optional(),
  status: z.string().trim().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type GetUsersQueryInput = z.infer<typeof getUsersQuerySchema>;
