import { z } from "zod";

export const packParamsSchema = z.object({
  id: z.string().uuid("Invalid pack ID format"),
});

export const createPackSchema = z.object({
  name: z
    .string({ required_error: "Pack name is required" })
    .trim()
    .min(2, "Pack name must be at least 2 characters")
    .max(150, "Pack name cannot exceed 150 characters"),
  pack_code: z
    .string({ required_error: "Pack code is required" })
    .trim()
    .min(2, "Pack code must be at least 2 characters")
    .max(100, "Pack code cannot exceed 100 characters")
    .regex(
      /^[a-z0-9_-]+$/i,
      "Pack code must contain only letters, numbers, hyphens, and underscores"
    ),
  description: z.string().trim().optional().default(""),
  status: z.enum(["Draft", "Published", "Retired"]).default("Draft"),
  price: z.coerce.number().min(0, "Price must be non-negative").default(0),
  currency: z.string().trim().min(2).max(10).default("INR"),
  cadence: z.string().trim().default("Monthly"),
  effective_date: z.string().optional().nullable(),
  extended_limits: z.string().trim().optional().default(""),
  prerequisite_note: z.string().trim().optional().default(""),
  included_feature_title: z.string().trim().optional().default(""),
  included_feature_subtitle: z.string().trim().optional().default(""),
  compatible_plans: z.array(z.string().trim().min(1)).default([]),
  required_modules: z.array(z.string().trim().min(1)).default([]),
});

export const updatePackSchema = createPackSchema.partial();

export const getPacksQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  compatibility: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreatePackInput = z.infer<typeof createPackSchema>;
export type UpdatePackInput = z.infer<typeof updatePackSchema>;
export type GetPacksQuery = z.infer<typeof getPacksQuerySchema>;
