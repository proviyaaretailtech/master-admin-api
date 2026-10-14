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

/** ol_order_holds.status (0331). */
export const HOLD_STATUSES = ["held", "released", "rejected"] as const;
export const holdsQuery = z.object({
  status: z.preprocess(emptyToUndef, z.enum(HOLD_STATUSES).optional()),
  q: optStr(100),
  ...pageQuery,
});
/** Both decisions need a reason: release sends the order to the restaurant, reject cancels and refunds it. */
export const holdDecisionBody = z.object({ reason: reasonSchema });
