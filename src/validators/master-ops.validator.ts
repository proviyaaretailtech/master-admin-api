import { z } from "zod";
import { minorSchema, optDate, optStr, optUuid, pageQuery, reasonSchema, uuidSchema } from "./master.validator";

const boolish = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean().optional());

export const auditQuery = z.object({
  actor: optUuid,
  entity_type: optStr(80),
  entity_id: optStr(200),
  org: optUuid,
  from: optDate,
  to: optDate,
  ...pageQuery,
});

export const ridersQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["draft", "submitted", "verification_pending", "approved", "rejected", "documents_expired", "suspended"]).optional()),
  city: optStr(60),
  q: optStr(100),
  ...pageQuery,
});

export const depositsQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["pending", "confirmed", "rejected"]).optional()),
  rider_id: optUuid,
  ...pageQuery,
});

export const riderActionBody = z.object({ reason: reasonSchema });
export const depositDecisionBody = z.object({ note: z.string().trim().max(500).optional() });

export const cityParams = z.object({ city_id: z.string().trim().min(1).max(60) });

export const rateCardBody = z
  .object({
    base_minor: minorSchema("base_minor"),
    per_km_minor: minorSchema("per_km_minor"),
    min_minor: minorSchema("min_minor"),
    active: z.boolean().default(true),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const policyBody = z
  .object({
    withdraw_min_minor: minorSchema("withdraw_min_minor"),
    withdraw_max_minor: minorSchema("withdraw_max_minor"),
    withdraw_per_day: z.number().int().min(1).max(100),
    default_cash_limit_minor: minorSchema("default_cash_limit_minor"),
    unavailable_wait_seconds: z.number().int().min(1).max(86400),
  })
  .strict()
  .refine((p) => p.withdraw_max_minor >= p.withdraw_min_minor, { message: "withdraw_max_minor cannot be below withdraw_min_minor", path: ["withdraw_max_minor"] });

const channel = z.enum(["dine_in", "delivery", "pickup", "online", "swiggy", "zomato", "other"]);
export const commissionQuery = z.object({
  organization_id: optUuid,
  channel: optStr(40),
  active: boolish,
  ...pageQuery,
});
const ruleFields = {
  organization_id: uuidSchema.nullable().optional(),
  channel: channel.nullable().optional(),
  pct_bps: z.number().int().min(0).max(10000),
  fixed_minor: minorSchema("fixed_minor"),
  min_minor: minorSchema("min_minor"),
  max_minor: minorSchema("max_minor").nullable().optional(),
};
export const commissionCreateBody = z
  .object({ ...ruleFields, fixed_minor: ruleFields.fixed_minor.default(0), min_minor: ruleFields.min_minor.default(0) })
  .strict()
  .refine((r) => r.max_minor == null || r.max_minor >= r.min_minor, { message: "max_minor cannot be below min_minor", path: ["max_minor"] });
export const commissionUpdateBody = z
  .object({
    reason: z.string().trim().min(3).max(500).optional(),
    pct_bps: ruleFields.pct_bps.optional(),
    fixed_minor: ruleFields.fixed_minor.optional(),
    min_minor: ruleFields.min_minor.optional(),
    max_minor: ruleFields.max_minor,
  })
  .strict()
  .refine((r) => Object.keys(r).filter((k) => k !== "reason").length > 0, "At least one field must be provided");
export const commissionDeactivateBody = z.object({ reason: z.string().trim().min(3).max(500).optional() });

export const ordersQuery = z.object({
  org: optUuid,
  status: optStr(40),
  channel: optStr(40),
  q: optStr(100),
  from: optDate,
  to: optDate,
  ...pageQuery,
});

export const dispatchJobsQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["created", "offered", "assigned", "at_pickup", "picked_up", "at_drop", "delivered", "exception", "cancelled"]).optional()),
  org: optUuid,
  page: pageQuery.page,
  // the dispatch board loads every active job in one response
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const dispatchReasonBody = z.object({ reason: reasonSchema });
export const dispatchCancelBody = z.object({
  reason: reasonSchema,
  code: z.enum(["restaurant_rejected", "restaurant_timed_out", "customer_cancelled", "other"]).default("other"),
});
export const exceptionResolveBody = z.object({
  outcome: z.enum(["resume", "reassign", "return", "fail", "cancel"]),
  note: z.string().trim().max(500).optional(),
});

export const paymentsQuery = z.object({ org: optUuid, method: optStr(40), from: optDate, to: optDate, ...pageQuery });
export const settlementsQuery = z.object({
  org: optUuid,
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["draft", "approved", "paid", "disputed"]).optional()),
  ...pageQuery,
});
export const payoutsQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["pending", "approved", "paid", "failed"]).optional()),
  payee_type: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["merchant", "rider", "partner"]).optional()),
  org: optUuid,
  ...pageQuery,
});
export const ledgerQuery = z.object({
  order_id: optUuid,
  type: optStr(40),
  org: optUuid,
  source: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["commission", "payment"]).optional()),
  ...pageQuery,
});
export const riderEarningsQuery = z.object({ from: optDate, to: optDate, rider_id: optUuid, ...pageQuery });
export const rangeQuery = z.object({ from: optDate, to: optDate });
export const runSettlementBody = z
  .object({
    organization_id: uuidSchema,
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "period_start must be YYYY-MM-DD"),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "period_end must be YYYY-MM-DD"),
  })
  .strict()
  .refine((b) => b.period_end >= b.period_start, { message: "period_end cannot be before period_start", path: ["period_end"] });
export const markPaidBody = z.object({ reference: z.string().trim().min(3).max(120) });

export const searchQuery = z.object({ q: z.string({ required_error: "q is required" }).trim().min(2, "q must be at least 2 characters").max(100) });
