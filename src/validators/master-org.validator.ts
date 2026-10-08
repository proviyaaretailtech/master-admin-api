import { z } from "zod";
import { optStr, optUuid, pageQuery, reasonSchema, uuidSchema } from "./master.validator";

export const orderingBody = z.object({ accepting: z.boolean({ required_error: "accepting is required", invalid_type_error: "accepting must be true or false" }), reason: reasonSchema }).strict();
export const subscriptionBody = z.object({ plan_code: z.string().trim().min(1).max(60), reason: reasonSchema }).strict();

export const invitationsQuery = z.object({
  org: optUuid,
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["pending", "accepted", "revoked", "expired"]).optional()),
  q: optStr(100),
  ...pageQuery,
});
export const inviteBody = z
  .object({
    organization_id: uuidSchema,
    email: z.string().trim().toLowerCase().email("Please provide a valid email address").max(255),
    role_slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9_]+$/, "role_slug must be lowercase letters, digits or underscores"),
  })
  .strict();
export const revokeBody = z.object({ reason: z.string().trim().min(3).max(500).optional() });
