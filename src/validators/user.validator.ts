import { z } from "zod";

export const createUserSchema = z.object({
  first_name: z.string().trim().min(2, "First name must be at least 2 characters").max(100),
  last_name: z.string().trim().min(1, "Last name is required").max(100),
  email: z.string().trim().email("Please provide a valid email address").toLowerCase(),
  phone_number: z.string().trim().min(7).max(30).regex(/^[0-9+\s\-()]+$/, "Please enter a valid phone number").optional(),
  password: z.string().min(10, "Password must be at least 10 characters long").max(128),
  role_id: z.string().uuid("Invalid role ID format").nullable().optional(),
});

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
  role_id: z.string().uuid("Invalid role ID format").nullable().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

export const getUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(9),
  search: z.string().trim().optional(),
  role_id: z.string().trim().optional(),
  status: z.string().trim().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type GetUsersQueryInput = z.infer<typeof getUsersQuerySchema>;
