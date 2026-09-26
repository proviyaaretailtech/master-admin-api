import { z } from "zod";

const LOCATION_TYPES = [
  "Restaurant",
  "Cloud Kitchen",
  "Delivery Hub",
  "Warehouse",
  "Retail Outlet",
  "Other",
] as const;

const LOCATION_STATUSES = ["Active", "Pending", "Inactive", "Draft"] as const;

export const createLocationSchema = z
  .object({
    name: z
      .string({ required_error: "Location name is required" })
      .trim()
      .min(2, "Location name must be at least 2 characters")
      .max(150, "Location name cannot exceed 150 characters"),
    area: z.string().trim().max(150, "Area cannot exceed 150 characters").optional().nullable(),
    code: z
      .string()
      .trim()
      .max(50, "Location code cannot exceed 50 characters")
      .optional()
      .nullable(),
    type: z
      .enum(LOCATION_TYPES, {
        errorMap: () => ({
          message: `Location type must be one of: ${LOCATION_TYPES.join(", ")}`,
        }),
      })
      .default("Restaurant"),
    status: z
      .enum(LOCATION_STATUSES, {
        errorMap: () => ({
          message: `Status must be one of: ${LOCATION_STATUSES.join(", ")}`,
        }),
      })
      .default("Active"),
    time_zone: z.string().trim().max(50).default("Asia/Kolkata").optional(),
    timeZone: z.string().trim().max(50).optional(),
    currency: z.string().trim().max(30).default("INR (₹)").optional(),
  })
  .transform((data) => ({
    name: data.name,
    area: data.area || null,
    code: data.code || null,
    type: data.type,
    status: data.status,
    time_zone: data.timeZone || data.time_zone || "Asia/Kolkata",
    currency: data.currency || "INR (₹)",
  }));

export const updateLocationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Location name must be at least 2 characters")
      .max(150, "Location name cannot exceed 150 characters")
      .optional(),
    area: z.string().trim().max(150, "Area cannot exceed 150 characters").optional().nullable(),
    code: z
      .string()
      .trim()
      .max(50, "Location code cannot exceed 50 characters")
      .optional()
      .nullable(),
    type: z
      .enum(LOCATION_TYPES, {
        errorMap: () => ({
          message: `Location type must be one of: ${LOCATION_TYPES.join(", ")}`,
        }),
      })
      .optional(),
    status: z
      .enum(LOCATION_STATUSES, {
        errorMap: () => ({
          message: `Status must be one of: ${LOCATION_STATUSES.join(", ")}`,
        }),
      })
      .optional(),
    time_zone: z.string().trim().max(50).optional(),
    timeZone: z.string().trim().max(50).optional(),
    currency: z.string().trim().max(30).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  })
  .transform((data) => ({
    ...data,
    time_zone: data.timeZone || data.time_zone,
  }));

export const getLocationsQuerySchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: "Page must be a valid number" })
    .int("Page must be an integer")
    .positive("Page must be greater than 0")
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: "Limit must be a valid number" })
    .int("Limit must be an integer")
    .positive("Limit must be greater than 0")
    .max(100, "Limit cannot exceed 100")
    .default(10),
  search: z.string().trim().max(100, "Search query cannot exceed 100 characters").optional(),
  status: z.enum(LOCATION_STATUSES).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  sortBy: z
    .enum(["name", "code", "area", "type", "status", "created_at", "updated_at"])
    .default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const locationParamsSchema = z.object({
  org_id: z.string().uuid("Invalid organization ID format (must be a valid UUID)"),
  id: z.string().uuid("Invalid location ID format (must be a valid UUID)").optional(),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type GetLocationsQueryInput = z.infer<typeof getLocationsQuerySchema>;
