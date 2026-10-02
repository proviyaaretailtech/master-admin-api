import { z } from "zod";
import { priceSchema, currencyCodeSchema, dateStringSchema, boundedInt, stringList } from "./common.validator";

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
  description: z.string().trim().max(2000).optional().default(""),
  category: z
    .string({ required_error: "Category is required" })
    .trim()
    .min(2, "Category must be at least 2 characters")
    .max(100, "Category cannot exceed 100 characters"),
  // `status` is a lifecycle request: it only takes effect with the publish_addon / retire_addon permission.
  // billing_sync_status / entitlement_validation_status / tax_compliance_status are system-managed
  // verification results and are deliberately NOT accepted from clients (zod drops them).
  status: z.enum(["Draft", "Published", "Retired"]).default("Draft"),
  version: z.string().trim().min(1).max(20).default("v1.0"),
  price: priceSchema.default(0),
  currency: currencyCodeSchema.default("INR"),
  cadence: z.string().trim().min(1).max(30).default("Monthly"),
  unit_label: z.string().trim().min(1).max(50).default("location"),
  pricing_subtitle: z.string().trim().max(300).optional().default(""),
  effective_date: dateStringSchema.optional().nullable(),
  min_quantity: boundedInt(1, 1_000_000, "Minimum quantity").default(1),
  max_quantity: boundedInt(1, 1_000_000, "Maximum quantity").default(10),
  compatible_plans: stringList(200, 150).default([]),
});

export const updateAddonSchema = createAddonSchema.partial();

export const getAddonsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  status: z.string().trim().max(50).optional(),
  compatibility: z.string().trim().max(150).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreateAddonInput = z.infer<typeof createAddonSchema>;
export type UpdateAddonInput = z.infer<typeof updateAddonSchema>;
export type GetAddonsQuery = z.infer<typeof getAddonsQuerySchema>;
