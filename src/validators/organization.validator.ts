import { z } from "zod";

// Phone number regex supporting international and standard formats: +1 (555) 019-2834, +91 9876543210, etc.
const PHONE_REGEX = /^\+?[0-9\s\-().]{7,25}$/;

export const createOrganizationSchema = z.object({
  business_name: z
    .string({ required_error: "Business name is required" })
    .trim()
    .min(2, "Business name must be at least 2 characters")
    .max(150, "Business name cannot exceed 150 characters"),
  domain: z
    .string({ required_error: "Domain is required" })
    .trim()
    .min(2, "Domain must be at least 2 characters")
    .max(100, "Domain cannot exceed 100 characters"),
  email: z
    .string({ required_error: "Email is required" })
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address")
    .max(255, "Email cannot exceed 255 characters"),
  phone_number: z
    .string({ required_error: "Phone number is required" })
    .trim()
    .regex(
      PHONE_REGEX,
      "Please provide a valid phone number (7-25 characters including digits and optional country code)"
    ),
  status: z
    .enum(["Active", "Inactive", "Pending", "Suspended", "Draft", "Approved", "Rejected"], {
      errorMap: () => ({
        message:
          "Status must be either 'Active', 'Inactive', 'Pending', 'Suspended', 'Draft', 'Approved', or 'Rejected'",
      }),
    })
    .default("Draft"),
});

export const updateOrganizationSchema = z
  .object({
    business_name: z
      .string()
      .trim()
      .min(2, "Business name must be at least 2 characters")
      .max(150, "Business name cannot exceed 150 characters")
      .optional(),
    domain: z
      .string()
      .trim()
      .min(2, "Domain must be at least 2 characters")
      .max(100, "Domain cannot exceed 100 characters")
      .optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Please provide a valid email address")
      .max(255, "Email cannot exceed 255 characters")
      .optional(),
    phone_number: z
      .string()
      .trim()
      .regex(PHONE_REGEX, "Please provide a valid phone number")
      .optional(),
    status: z
      .enum(["Active", "Inactive", "Pending", "Suspended", "Draft", "Approved", "Rejected"], {
        errorMap: () => ({
          message:
            "Status must be either 'Active', 'Inactive', 'Pending', 'Suspended', 'Draft', 'Approved', or 'Rejected'",
        }),
      })
      .optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided to update an organization"
  );

export const getOrganizationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Page must be a positive integer").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100")
    .default(10),
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().optional(),
  domain: z.string().trim().optional(),
  sortBy: z
    .enum(["business_name", "domain", "status", "email", "phone_number", "created_at"])
    .default("created_at"),
  sortOrder: z.enum(["asc", "desc", "ASC", "DESC"]).default("desc"),
});

export const organizationIdParamSchema = z.object({
  id: z
    .string({ required_error: "Organization ID is required" })
    .uuid("Invalid organization ID format. Must be a valid UUID"),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type GetOrganizationsQueryInput = z.infer<typeof getOrganizationsQuerySchema>;
