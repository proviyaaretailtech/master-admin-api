import { z } from "zod";
import { optStr, pageQuery, reasonSchema } from "./master.validator";

const emptyToUndef = (v: unknown) => (v === "" || v === "all" ? undefined : v);

/** ol_partner_applications.status (0335). */
export const APPLICATION_STATUSES = ["draft", "submitted", "reviewing", "approved", "rejected", "withdrawn"] as const;
export const applicationsQuery = z.object({
  status: z.preprocess(emptyToUndef, z.enum(APPLICATION_STATUSES).optional()),
  city: optStr(60),
  q: optStr(100),
  ...pageQuery,
});
/** Approve: the note is optional. Reject: a reason of 3 to 500 characters (the database checks it again). */
export const approveApplicationBody = z.object({ reason: z.string().trim().min(3).max(500).optional() });
export const rejectApplicationBody = z.object({ reason: reasonSchema });

/** The four verification checks (ol_partner_application_checks, 0348/0372). A failed check needs a note (the database checks it again). */
export const CHECK_KINDS = ["individual_identity", "business_identity", "business_address", "bank_ownership"] as const;
export const checkParams = z.object({ id: z.string().uuid(), kind: z.enum(CHECK_KINDS) });
export const checkBody = z
  .object({ status: z.enum(["pending", "under_review", "verified", "failed"]), note: z.string().trim().max(500).optional() })
  .refine((b) => b.status !== "failed" || (b.note ?? "").length >= 3, { message: "A note of 3 to 500 characters is required when a check fails", path: ["note"] });

/** One uploaded document (0630). Rejecting needs a note. */
export const documentParams = z.object({ id: z.string().uuid(), docId: z.string().uuid() });
export const documentBody = z
  .object({ status: z.enum(["under_review", "verified", "rejected"]), note: z.string().trim().max(500).optional() })
  .refine((b) => b.status !== "rejected" || (b.note ?? "").length >= 3, { message: "A note of 3 to 500 characters is required to reject a document", path: ["note"] });

/** Customers list: search by email/phone, and show real, test or all accounts (default: real only). */
export const customersQuery = z.object({
  q: optStr(100),
  accounts: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["real", "test", "all"]).default("real")),
  ...pageQuery,
});

/** Support inbox (0631): customer requests and partner requests in one list. */
export const supportQuery = z.object({
  source: z.preprocess(emptyToUndef, z.enum(["customer", "partner"]).optional()),
  status: z.preprocess(emptyToUndef, z.enum(["open", "in_progress", "resolved"]).optional()),
  mine: z.preprocess((v) => v === "true" || v === true, z.boolean()).default(false),
  q: optStr(100),
  ...pageQuery,
});
export const supportParams = z.object({ source: z.enum(["customer", "partner"]), id: z.string().uuid() });
/** Assign to me, change status, add an internal note, or several at once. Resolving needs a note (the database checks it again). */
export const supportUpdateBody = z
  .object({
    status: z.enum(["open", "in_progress", "resolved"]).optional(),
    assign_to_me: z.boolean().optional(),
    note: z.string().trim().min(2).max(2000).optional(),
  })
  .refine((b) => b.status || b.assign_to_me || b.note, { message: "Nothing to change" })
  .refine((b) => b.status !== "resolved" || Boolean(b.note), { message: "A note is required to resolve a request", path: ["note"] });

/** Platform hold on a business (master_set_platform_hold): always with a reason. */
export const platformHoldBody = z.object({ hold: z.boolean(), reason: reasonSchema });

/** ol_order_holds.status (0331). */
export const HOLD_STATUSES = ["held", "released", "rejected"] as const;
export const holdsQuery = z.object({
  status: z.preprocess(emptyToUndef, z.enum(HOLD_STATUSES).optional()),
  q: optStr(100),
  ...pageQuery,
});
/** Both decisions need a reason: release sends the order to the restaurant, reject cancels and refunds it. */
export const holdDecisionBody = z.object({ reason: reasonSchema });
