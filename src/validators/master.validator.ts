import { z } from "zod";

export const uuidSchema = z.string().uuid("Must be a valid UUID");
export const idParams = z.object({ id: uuidSchema });

/** Optional filter that may arrive as an empty string from a form: treated as absent. */
const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);

export const pageQuery = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const optStr = (max = 100) => z.preprocess(emptyToUndef, z.string().trim().min(1).max(max).optional());
export const optUuid = z.preprocess(emptyToUndef, uuidSchema.optional());
export const optDate = z.preprocess(
  emptyToUndef,
  z
    .string()
    .trim()
    .max(40)
    .refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date")
    .optional()
);

/** A mandatory human reason for a sensitive action. */
export const reasonSchema = z.string({ required_error: "A reason is required" }).trim().min(3, "Reason must be at least 3 characters").max(500);
export const reasonBody = z.object({ reason: reasonSchema });
export const noteBody = z.object({ note: z.string().trim().max(500).optional() });

/** Integer minor units (paise/cents): whole, non-negative, within a safe range. */
export const minorSchema = (label = "Amount") =>
  z
    .number({ invalid_type_error: `${label} must be a whole number of minor units`, required_error: `${label} is required` })
    .int(`${label} must be a whole number of minor units`)
    .min(0, `${label} cannot be negative`)
    .max(9_000_000_000_000, `${label} is too large`);

export const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code")
  .transform((c) => c.toUpperCase());

export function pageMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Escapes LIKE wildcards so user input is matched literally. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
