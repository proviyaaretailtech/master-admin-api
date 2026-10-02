import { query } from "../../config/database.config";
import { DEFAULT_FEATURES_TEMPLATE, serializeFeaturesToDb } from "../../utils/permission-adapter";

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Ensures a platform role exists (by key) and returns its id. The system super_admin role is seeded by migration 0111. */
export async function ensureRole(opts: {
  key: string;
  name?: string;
  permissions?: string;
  is_system?: boolean;
  scope?: string;
}): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO platform_roles (name, key, scope, description, is_active, is_system, permissions)
     VALUES ($1, $2, $3, 'test role', true, $4, $5)
     ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
     RETURNING id;`,
    [opts.name ?? opts.key, opts.key, opts.scope ?? "Platform", opts.is_system ?? false, opts.permissions ?? ""]
  );
  return res.rows[0].id;
}

export interface TestStaff {
  id: string;
  email: string;
  token: string;
  roleId: string | null;
}

/** Creates an auth user + platform_admins row. `roleKey` null = no role (restricted). Token = "test:<id>". */
export async function createStaff(opts: {
  roleKey?: string | null;
  status?: string;
  firstName?: string;
  lastName?: string;
} = {}): Promise<TestStaff> {
  const email = `staff-${uniq()}@test.local`;
  const u = await query<{ id: string }>(
    `INSERT INTO auth.users (id, instance_id, aud, role, email)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1) RETURNING id;`,
    [email]
  );
  const id = u.rows[0].id;
  let roleId: string | null = null;
  if (opts.roleKey) {
    const r = await query<{ id: string }>("SELECT id FROM platform_roles WHERE key = $1;", [opts.roleKey]);
    roleId = r.rows[0]?.id ?? null;
  }
  await query(
    `INSERT INTO platform_admins (user_id, role_id, first_name, last_name, phone_number, status)
     VALUES ($1, $2, $3, $4, '+15550000000', $5);`,
    [id, roleId, opts.firstName ?? "Test", opts.lastName ?? "Staff", opts.status ?? "Active"]
  );
  return { id, email, token: `test:${id}`, roleId };
}

/** Creates an organization the same way the app does (canonical table + default location). Returns its id. */
export async function createOrg(overrides: { name?: string; status?: string } = {}): Promise<string> {
  const n = uniq();
  const r = await query<{ result: { organization_id: string } }>(
    "SELECT public.master_create_organization($1::jsonb) AS result;",
    [
      JSON.stringify({
        name: overrides.name ?? `Test Org ${n}`,
        business_domain: "Restaurant",
        control_status: overrides.status ?? "Active",
        contact_email: `org-${n}@test.local`,
        contact_phone: `+9190${Math.floor(10000000 + Math.random() * 89999999)}`,
      }),
    ]
  );
  return r.rows[0].result.organization_id;
}

/** Removes data created by tests (organizations cascade to locations/subscriptions). */
export async function cleanup(opts: { orgIds?: string[]; staffIds?: string[]; roleKeys?: string[] } = {}) {
  for (const id of opts.orgIds ?? []) await query("DELETE FROM organizations WHERE id = $1;", [id]);
  for (const id of opts.staffIds ?? []) await query("DELETE FROM auth.users WHERE id = $1;", [id]);
  for (const key of opts.roleKeys ?? []) await query("DELETE FROM platform_roles WHERE key = $1 AND is_system = false;", [key]);
}

/**
 * Builds a stored permission string from a compact spec: { feature_id: [action keys] } (level "full") or
 * { feature_id: { level: "read_only", actions: [...] } }. "all" enables every action of the feature.
 */
export function permString(
  spec: Record<string, string[] | "all" | { level: "read_only" | "full"; actions: string[] | "all" }>
): string {
  const features = DEFAULT_FEATURES_TEMPLATE.filter((f) => spec[f.id] !== undefined).map((f) => {
    const raw = spec[f.id];
    const cfg = Array.isArray(raw) || raw === "all" ? { level: "full" as const, actions: raw } : raw;
    const keys = cfg.actions === "all" ? f.actions.map((a) => a.key) : cfg.actions;
    return { ...f, accessLevel: cfg.level, actions: f.actions.map((a) => ({ ...a, enabled: keys.includes(a.key) })) };
  });
  return serializeFeaturesToDb(features);
}

/** Plain wire-format features (as the frontend sends them) granting `actions` at full access on one feature. */
export function wireFeature(featureId: string, actions: string[], level: "none" | "read_only" | "full" = "full") {
  const f = DEFAULT_FEATURES_TEMPLATE.find((x) => x.id === featureId)!;
  return { id: featureId, accessLevel: level, actions: f.actions.map((a) => ({ key: a.key, enabled: actions.includes(a.key) })) };
}

/** Reads a role's stored permission string. */
export async function rolePermissions(roleId: string): Promise<string> {
  const r = await query<{ permissions: string }>("SELECT permissions FROM platform_roles WHERE id = $1;", [roleId]);
  return r.rows[0]?.permissions ?? "";
}
