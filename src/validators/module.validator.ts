import { z } from "zod";

export const moduleParamsSchema = z.object({
  id: z.string().uuid("Invalid module ID format"),
});

export const createModuleSchema = z.object({
  key: z
    .string({ required_error: "Module key is required" })
    .trim()
    .min(2, "Module key must be at least 2 characters")
    .max(6, "Module key cannot exceed 6 characters")
    .regex(/^[A-Z0-9_]+$/i, "Module key must contain alphanumeric characters or underscores"),
  name: z
    .string({ required_error: "Module name is required" })
    .trim()
    .min(2, "Module name must be at least 2 characters")
    .max(150, "Module name cannot exceed 150 characters"),
  category: z.string().trim().max(100).default("Core"),
  description: z.string().trim().optional().default(""),
  is_active: z.boolean().default(true),
});

export const updateModuleSchema = createModuleSchema.partial();

export type CreateModuleInput = z.infer<typeof createModuleSchema>;
export type UpdateModuleInput = z.infer<typeof updateModuleSchema>;
