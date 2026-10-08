import { z } from "zod";
import { optDate, optStr, optUuid, pageQuery, reasonSchema, uuidSchema } from "./master.validator";

const enumOpt = <T extends readonly [string, ...string[]]>(vals: T) => z.preprocess((v) => (v === "" ? undefined : v), z.enum(vals as unknown as [string, ...string[]]).optional());
const CATEGORIES = ["crm", "cms", "payment_gateway", "messaging", "maps", "analytics", "other"] as const;
const jsonObject = z.record(z.unknown());

export const integrationsQuery = z.object({
  category: enumOpt(CATEGORIES),
  status: enumOpt(["draft", "connected", "error", "disabled"]),
  org: optUuid,
  ...pageQuery,
});
export const integrationCreateBody = z
  .object({
    category: z.enum(CATEGORIES),
    provider: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,39}$/, "provider must be 2-40 lowercase letters, digits, _ or -"),
    name: z.string().trim().min(3, "name must be at least 3 characters").max(80),
    organization_id: uuidSchema.nullable().optional(),
    config: jsonObject.optional(),
  })
  .strict();
export const integrationUpdateBody = z
  .object({ name: z.string().trim().min(3).max(80).optional(), config: jsonObject.optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.config !== undefined, "Provide name or config");
export const integrationToggleBody = z.object({ reason: z.string().trim().min(3).max(500).optional() });
export const disableBody = z.object({ reason: reasonSchema });
/** Integration disable: the reason is optional (the Master UI sends none); a default is recorded. */
export const integrationDisableBody = z.object({ reason: z.string().trim().min(3).max(500).optional() });
export const rotateBody = z
  .object({ credential_ref: z.string().trim().regex(/^[a-z0-9][a-z0-9_.:/-]{2,119}$/, "credential_ref must be the NAME of a vault secret (lowercase letters, digits, . _ : / -), never the secret").optional() })
  .strict();
export const logsQuery = z.object({ level: enumOpt(["info", "warn", "error"]), ...pageQuery });
export const mappingsQuery = z.object({ kind: enumOpt(["crm_field", "cms_content", "cms_placement"]) });
const kinds = ["crm_field", "cms_content", "cms_placement"] as const;
/** UI shape: all kinds in one call, {mappings:[{kind,source,target}]}. */
export const mappingsUiBody = z
  .object({
    mappings: z.array(z.object({ kind: z.enum(kinds), source: z.string().trim().min(1).max(120), target: z.string().trim().min(1).max(120), direction: z.enum(["inbound", "outbound", "both"]).optional() })).max(500),
  })
  .strict();
export const mappingsBody = z
  .object({
    kind: z.enum(kinds),
    items: z
      .array(
        z.object({
          source_key: z.string().trim().min(1).max(120),
          target_key: z.string().trim().min(1).max(120),
          direction: z.enum(["inbound", "outbound", "both"]).optional(),
          config: jsonObject.optional(),
        })
      )
      .max(500),
  })
  .strict();

export const apiAppsQuery = z.object({ status: enumOpt(["active", "disabled", "revoked"]), org: optUuid, ...pageQuery });
export const apiAppCreateBody = z
  .object({
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().max(500).optional(),
    organization_id: uuidSchema.nullable().optional(),
    scopes: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]*:[a-z0-9_*]+$/, "scope must look like resource:action")).max(50).default([]),
    expires_in_days: z.number().int().min(1).max(366).optional(),
  })
  .strict();
export const apiAppRotateBody = z
  .object({ overlap_hours: z.number().int().min(0).max(168).default(24), expires_in_days: z.number().int().min(1).max(366).optional() })
  .strict();
export const apiLogsQuery = z.object({ app: optUuid, status: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(100).max(599).optional()), from: optDate, to: optDate, ...pageQuery });

export const webhookDeliveriesQuery = z.object({ endpoint: optUuid, status: optStr(30), ...pageQuery });

export const webhooksQuery = z.object({ status: enumOpt(["active", "disabled"]), org: optUuid, ...pageQuery });
export const webhookCreateBody = z
  .object({
    name: z.string().trim().min(3).max(80),
    url: z.string().trim().max(500).regex(/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s?#@]*)?$/, "url must be https, without credentials, query string or fragment"),
    events: z.array(z.string().trim().min(1).max(80)).min(1, "Subscribe to at least one event").max(50),
    secret_ref: z.string().trim().regex(/^[a-z0-9][a-z0-9_.:/-]{2,119}$/, "secret_ref must be the NAME of a vault secret, never the secret"),
    organization_id: uuidSchema.nullable().optional(),
  })
  .strict();
export const webhookDisableBody = z.object({ reason: reasonSchema });
