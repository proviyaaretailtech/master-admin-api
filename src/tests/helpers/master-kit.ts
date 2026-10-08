import { randomUUID } from "crypto";
import { query } from "../../config/database.config";
import { ensureRole, createStaff, permString, TestStaff } from "./testkit";

let n = 0;
export const tag = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Staff whose role grants exactly `spec` (feature -> actions at full, or {level, actions}); no super-admin bypass. */
export async function staffWith(
  spec: Parameters<typeof permString>[0],
  roleKeys: string[]
): Promise<TestStaff> {
  const key = `mk_role_${tag()}`;
  await ensureRole({ key, name: key, permissions: permString(spec) });
  roleKeys.push(key);
  return createStaff({ roleKey: key });
}

export const bearer = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

/** A service area (city) for rider pay / delivery tests. */
export async function seedCity(): Promise<string> {
  const id = `tc${tag()}`.slice(0, 20);
  await query(`INSERT INTO ol_service_areas (city_id, name, lat, lng, radius_km) VALUES ($1, $2, 18.4, 76.5, 10);`, [id, `City ${id}`]);
  return id;
}

export async function seedPlan(code: string, opts: { locations?: number; users?: number } = {}): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO commercial_plans (plan_code, name, status, version_type, price, locations_limit, users_limit, trial_days)
     VALUES ($1, $1, 'Published', 'Active', 100, $2, $3, 0) ON CONFLICT (plan_code) DO UPDATE SET status = 'Published' RETURNING id;`,
    [code, opts.locations ?? 5, opts.users ?? 20]
  );
  return r.rows[0].id;
}

export async function seedRider(opts: { status?: string; city?: string; org?: string | null; name?: string } = {}): Promise<string> {
  const u = await query<{ id: string }>(
    `INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1) RETURNING id;`,
    [`rider-${tag()}@test.local`]
  );
  const r = await query<{ id: string }>(
    `INSERT INTO riders (user_id, full_name, phone, status, city_id, organization_id, type) VALUES ($1, $2, $3, $4, $5, $6, 'solo') RETURNING id;`,
    [u.rows[0].id, opts.name ?? `Rider ${tag()}`, `+9170${Math.floor(10000000 + Math.random() * 89999999)}`, opts.status ?? "submitted", opts.city ?? null, opts.org ?? null]
  );
  return r.rows[0].id;
}

let orderNo = 900000;
export async function seedOrder(org: string, o: { status?: string; total?: number; channel?: string } = {}): Promise<string> {
  const total = o.total ?? 500;
  const r = await query<{ id: string }>(
    `INSERT INTO orders (organization_id, order_no, display_no, status, channel, subtotal, total)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id;`,
    [org, ++orderNo + Math.floor(Math.random() * 1000), `MK-${tag()}`.slice(0, 24), o.status ?? "new", o.channel ?? "dine_in", total]
  );
  return r.rows[0].id;
}

/** A consumer order plus its delivery job (open by default). */
export async function seedJob(org: string | null, o: { status?: string; city?: string; rider?: string | null } = {}): Promise<{ jobId: string; olOrderId: string }> {
  const ol = await query<{ id: string }>(
    `INSERT INTO ol_orders (customer_hash, items, subtotal, total, organization_id, city_id) VALUES ($1, '[]'::jsonb, 100, 100, $2, $3) RETURNING id;`,
    [`h${tag()}`, org, o.city ?? "latur"]
  );
  const j = await query<{ id: string }>(
    `INSERT INTO delivery_jobs (ol_order_id, organization_id, city_id, status, idempotency_key, payment_mode, pickup_name, pickup_lat, pickup_lng, drop_lat, drop_lng, otp_hash, rider_id, order_no)
     VALUES ($1, $2, $3, $4, $5, 'online', 'Kitchen', 18.4, 76.5, 18.41, 76.51, 'x', $6, $7) RETURNING id;`,
    [ol.rows[0].id, org, o.city ?? "latur", o.status ?? "created", `idem-${tag()}-${randomUUID()}`, o.rider ?? null, `J${tag()}`.slice(0, 12)]
  );
  return { jobId: j.rows[0].id, olOrderId: ol.rows[0].id };
}

/** Deletes rows the helpers above created for the given organizations (children first). */
export async function wipeOrgData(orgIds: string[]) {
  if (!orgIds.length) return;
  await query(`DELETE FROM delivery_events WHERE job_id IN (SELECT id FROM delivery_jobs WHERE organization_id = ANY($1::uuid[]));`, [orgIds]).catch(() => undefined);
  await query(`DELETE FROM delivery_jobs WHERE organization_id = ANY($1::uuid[]);`, [orgIds]).catch(() => undefined);
  await query(`DELETE FROM ol_orders WHERE organization_id = ANY($1::uuid[]);`, [orgIds]).catch(() => undefined);
  await query(`DELETE FROM orders WHERE organization_id = ANY($1::uuid[]);`, [orgIds]).catch(() => undefined);
}
