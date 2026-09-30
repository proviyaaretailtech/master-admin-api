import { z } from "zod";

export const addonParamsSchema = z.object({
  id: z.string().uuid("Invalid add-on ID format"),
});

export const createAddonSchema = z.object({
  name: z
    .string({ required_error: "Add-on name is required" })
    .trim()
    .min(2, "Add-on name must be at least 2 characters")
    .max(150, "Add-on name cannot exceed 150 characters"),
  addon_code: z
    .string({ required_error: "Add-on code is required" })
    .trim()
    .min(2, "Add-on code must be at least 2 characters")
    .max(100, "Add-on code cannot exceed 100 characters")
    .regex(
      /^[a-z0-9_-]+$/i,
      "Add-on code must contain only letters, numbers, hyphens, and underscores"
    ),
  description: z.string().trim().optional().default(""),
  category: z
    .string({ required_error: "Category is required" })
    .trim()
    .min(2, "Category must be at least 2 characters")
    .max(100, "Category cannot exceed 100 characters"),
  status: z.enum(["Draft", "Published", "Retired"]).default("Draft"),
  version: z.string().trim().default("v1.0"),
  price: z.coerce.number().min(0, "Price must be non-negative").default(0),
  currency: z.string().trim().min(2).max(10).default("INR"),
  cadence: z.string().trim().default("Monthly"),
  unit_label: z.string().trim().default("location"),
  pricing_subtitle: z.string().trim().optional().default(""),
  effective_date: z.string().optional().nullable(),
  min_quantity: z.coerce.number().int().min(1, "Minimum quantity must be at least 1").default(1),
  max_quantity: z.coerce.number().int().min(1, "Maximum quantity must be at least 1").default(10),
  compatible_plans: z.array(z.string().trim().min(1)).default([]),
  billing_sync_status: z.string().trim().optional().default("Success"),
  entitlement_validation_status: z.string().trim().optional().default("Passed"),
  tax_compliance_status: z.string().trim().optional().default("Pending verification"),
});

export const updateAddonSchema = createAddonSchema.partial();

export const getAddonsQuerySchema = z.object({
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  status: z.string().trim().optional(),
  compatibility: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreateAddonInput = z.infer<typeof createAddonSchema>;
export type UpdateAddonInput = z.infer<typeof updateAddonSchema>;
export type GetAddonsQuery = z.infer<typeof getAddonsQuerySchema>;
