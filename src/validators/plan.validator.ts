import { z } from "zod";

export const planParamsSchema = z.object({
  id: z.string().uuid("Invalid plan ID format"),
});

export const createPlanSchema = z.object({
  name: z
    .string({ required_error: "Plan name is required" })
    .trim()
    .min(2, "Plan name must be at least 2 characters")
    .max(150, "Plan name cannot exceed 150 characters"),
  plan_code: z
    .string({ required_error: "Plan code is required" })
    .trim()
    .min(2, "Plan code must be at least 2 characters")
    .max(100, "Plan code cannot exceed 100 characters")
    .regex(
      /^[a-z0-9_-]+$/,
      "Plan code must contain only lowercase letters, numbers, hyphens, and underscores"
    ),
  version: z.string().trim().max(10).default("v1.0"),
  version_type: z.enum(["Draft", "Active", "Custom", "Legacy"]).default("Draft"),
  status: z.enum(["Draft", "Published", "Retired"]).default("Draft"),
  price: z.coerce.number().min(0, "Price must be non-negative").default(0),
  currency: z.string().trim().min(2).max(10).default("INR"),
  cadence: z.enum(["Monthly", "Annual", "Quarterly"]).default("Monthly"),
  tax_note: z.string().trim().max(150).default("+18% GST Applicable"),
  trial_days: z.coerce.number().int().min(0).default(3),
  effective_date: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .or(z.string().optional()),
  locations_limit: z.coerce.number().int().min(1, "Locations limit must be at least 1").default(1),
  users_limit: z.coerce.number().int().min(1, "Users limit must be at least 1").default(3),
  is_unlimited_locations: z.boolean().default(false),
  is_unlimited_users: z.boolean().default(false),
  modules: z.array(z.string().trim().min(1)).default([]),
});

export const updatePlanSchema = createPlanSchema.partial();

export const getPlansQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  cadence: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type GetPlansQueryInput = z.infer<typeof getPlansQuerySchema>;
