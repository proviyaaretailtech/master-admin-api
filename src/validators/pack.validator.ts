import { z } from "zod";
import { priceSchema, currencyCodeSchema, dateStringSchema, stringList } from "./common.validator";

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
  description: z.string().trim().max(2000).optional().default(""),
  // `status` is a lifecycle request: it only takes effect with the publish_pack / retire_pack permission.
  status: z.enum(["Draft", "Published", "Retired"]).default("Draft"),
  price: priceSchema.default(0),
  currency: currencyCodeSchema.default("INR"),
  cadence: z.string().trim().min(1).max(30).default("Monthly"),
  effective_date: dateStringSchema.optional().nullable(),
  extended_limits: z.string().trim().max(500).optional().default(""),
  prerequisite_note: z.string().trim().max(500).optional().default(""),
  included_feature_title: z.string().trim().max(200).optional().default(""),
  included_feature_subtitle: z.string().trim().max(300).optional().default(""),
  compatible_plans: stringList(200, 150).default([]),
  required_modules: stringList(200, 50).default([]),
});

export const updatePackSchema = createPackSchema.partial();

export const getPacksQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().max(50).optional(),
  compatibility: z.string().trim().max(150).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreatePackInput = z.infer<typeof createPackSchema>;
export type UpdatePackInput = z.infer<typeof updatePackSchema>;
export type GetPacksQuery = z.infer<typeof getPacksQuerySchema>;
