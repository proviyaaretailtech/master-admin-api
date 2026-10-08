import { query, queryAs } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { NotFoundException } from "../../utils/app-error";

/** Currency reported for platform-level rules that carry none of their own. */
export const PLATFORM_CURRENCY = "INR";

export type Row = Record<string, unknown>;

/** Keys whose values never leave the server, wherever they appear in a stored row. */
const SECRET_KEY = /(^|_)(otp_hash|password|passwd|secret|token|key_hash|api_key|signing|authorization|credential|credentials|private_key)(_|$)/i;

/** Recursively removes secret-looking keys from stored JSON (audit before/after, logs, provider payloads). */
export function scrub<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => scrub(v)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = scrub(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Records a control-plane action that has no row change of its own (a call to the dispatch service, a
 * provider test) in audit_logs, attributed to the acting staff member.
 */
export async function recordAudit(
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  organizationId: string | null,
  detail: Row
): Promise<void> {
  await query(
    `INSERT INTO audit_logs (organization_id, actor_user_id, actor_db_role, action, entity_type, entity_id, after)
     VALUES ($1, $2, 'platform_staff', $3, $4, $5, $6::jsonb);`,
    [organizationId, actor.id, action, entityType, entityId, JSON.stringify(scrub(detail))]
  );
}

/** Loads one row by id or throws a 404. */
export async function mustExist(table: string, id: string, label: string, extraWhere = ""): Promise<Row> {
  const r = await query<Row>(`SELECT * FROM ${table} WHERE id = $1 ${extraWhere} LIMIT 1;`, [id]);
  if (!r.rows[0]) throw new NotFoundException(`${label} not found`);
  return r.rows[0];
}

/** Builds a parameterised WHERE clause incrementally. */
export class Where {
  private parts: string[] = [];
  readonly values: unknown[] = [];
  add(sqlWithPlaceholder: string, value?: unknown): this {
    if (value === undefined || value === null) return this;
    this.values.push(value);
    this.parts.push(sqlWithPlaceholder.replace(/\$\?/g, `$${this.values.length}`));
    return this;
  }
  raw(sql: string): this {
    this.parts.push(sql);
    return this;
  }
  get sql(): string {
    return this.parts.length ? `WHERE ${this.parts.join(" AND ")}` : "";
  }
}

export { query, queryAs };
