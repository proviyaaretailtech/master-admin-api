import { z } from "zod";

const actionSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().optional().default(""),
  description: z.string().optional().default(""),
  enabled: z.boolean(),
});

const featurePermissionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().optional().default(""),
  category: z
    .enum(["commercials", "partner_detail", "organization", "access_control", "system"])
    .optional()
    .default("system"),
  pagePath: z.string().optional().default(""),
  description: z.string().optional().default(""),
  accessLevel: z.enum(["none", "read_only", "full"]).default("none"),
  actions: z.array(actionSchema).default([]),
});

export const createRoleSchema = z.object({
  name: z
    .string({ required_error: "Role name is required" })
    .trim()
    .min(2, "Role name must be at least 2 characters")
    .max(100, "Role name cannot exceed 100 characters"),
  key: z
    .string({ required_error: "Role key is required" })
    .trim()
    .min(2, "Role key must be at least 2 characters")
    .max(100, "Role key cannot exceed 100 characters")
    .regex(
      /^[a-z0-9_]+$/,
      "Role key must contain only lowercase letters, numbers, and underscores"
    ),
  scope: z.string().trim().max(50).default("One organization"),
  description: z.string().trim().max(500).optional().default(""),
  isActive: z.boolean().default(true),
  features: z.array(featurePermissionSchema).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  scope: z.string().trim().max(50).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
  features: z.array(featurePermissionSchema).optional(),
});

export const roleIdParamSchema = z.object({
  id: z.string().uuid("Invalid role ID format. Expected a valid UUID."),
});

export const getRolesQuerySchema = z.object({
  search: z.string().trim().optional(),
  scope: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type GetRolesQuery = z.infer<typeof getRolesQuerySchema>;
