import { z } from "zod";
import { priceSchema, currencyCodeSchema, dateStringSchema, boundedInt, stringList } from "./common.validator";

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
  // Lifecycle fields: `status` is a request that only takes effect with the publish_plan / retire_plan
  // permission, and `version_type` follows the lifecycle (only "Custom" is a free choice). See utils/lifecycle.ts.
  version_type: z.enum(["Draft", "Active", "Custom", "Legacy"]).default("Draft"),
  status: z.enum(["Draft", "Published", "Retired"]).default("Draft"),
  price: priceSchema.default(0),
  currency: currencyCodeSchema.default("INR"),
  cadence: z.enum(["Monthly", "Annual", "Quarterly"]).default("Monthly"),
  tax_note: z.string().trim().max(150).default("+18% GST Applicable"),
  trial_days: boundedInt(0, 3650, "Trial days").default(3),
  effective_date: dateStringSchema.optional().nullable(),
  locations_limit: boundedInt(1, 1_000_000, "Locations limit").default(1),
  users_limit: boundedInt(1, 1_000_000, "Users limit").default(3),
  is_unlimited_locations: z.boolean().default(false),
  is_unlimited_users: z.boolean().default(false),
  modules: stringList(200, 50).default([]),
});

export const updatePlanSchema = createPlanSchema.partial();

export const getPlansQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().max(50).optional(),
  cadence: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type GetPlansQueryInput = z.infer<typeof getPlansQuerySchema>;
