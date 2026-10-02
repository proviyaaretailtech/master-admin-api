import { z } from "zod";

/** Money amounts are stored as numeric(12,2): finite, non-negative and within range. */
export const priceSchema = z.coerce
  .number({ invalid_type_error: "Price must be a number" })
  .finite("Price must be a finite number")
  .min(0, "Price must be non-negative")
  .max(9_999_999_999.99, "Price is too large");

/** ISO 4217 style currency code; stored upper-case (the database enforces ^[A-Z]{3}$). */
export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code such as INR")
  .transform((c) => c.toUpperCase());

/** A date or timestamp string that actually parses (an unparseable value would reach the database and fail). */
export const dateStringSchema = z
  .string()
  .trim()
  .max(40)
  .refine((d) => d === "" || !Number.isNaN(Date.parse(d)), "Invalid date");

/** Whole number bounded to what an INTEGER column can hold, with a sane business ceiling. */
export const boundedInt = (min: number, max: number, label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} cannot exceed ${max}`);

/** A short list of trimmed, bounded strings (module keys, plan names, ...). */
export const stringList = (maxItems: number, maxLength: number) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);
