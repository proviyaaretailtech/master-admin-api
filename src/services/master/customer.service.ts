import { query } from "../../config/database.config";
import { likePattern, pageMeta } from "../../validators/master.validator";
import { Row } from "./common";

/**
 * Customers: everyone with a login who is not partner staff (org_users), a rider or platform staff. The database has
 * no customer flag on a login, so this is the definition, applied in one place.
 *
 * Email and phone are masked here, on the server, so the full values never reach the panel. A login whose email is
 * on a test domain (.test, .local, .invalid, example.*) is counted separately as a test account.
 */
const CUSTOMER = `NOT EXISTS (SELECT 1 FROM org_users o WHERE o.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM riders r WHERE r.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM platform_admins p WHERE p.user_id = u.id)
  AND u.deleted_at IS NULL`;
const IS_TEST = `(u.email ~* '@([a-z0-9-]+\\.)*(test|local|invalid|localhost)$' OR u.email ~* '@example\\.')`;

export const customerService = {
  async summary() {
    const r = await query<Row>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE NOT ${IS_TEST} OR u.email IS NULL)::int AS real,
              count(*) FILTER (WHERE ${IS_TEST})::int AS test,
              -- the activity tiles count real customers only, so they can be read against "real"
              count(*) FILTER (WHERE (NOT ${IS_TEST} OR u.email IS NULL) AND u.last_sign_in_at > now() - interval '30 days')::int AS active_30d,
              count(*) FILTER (WHERE (NOT ${IS_TEST} OR u.email IS NULL) AND EXISTS (SELECT 1 FROM ol_orders oo WHERE oo.user_id = u.id))::int AS ordered
         FROM auth.users u WHERE ${CUSTOMER};`
    );
    return r.rows[0];
  },

  async list(f: { q?: string; test?: boolean; page: number; limit: number }) {
    const values: unknown[] = [];
    let where = CUSTOMER;
    if (f.test === false) where += ` AND (NOT ${IS_TEST} OR u.email IS NULL)`;
    if (f.test === true) where += ` AND ${IS_TEST}`;
    if (f.q) {
      values.push(likePattern(f.q));
      where += ` AND (u.email ILIKE $${values.length} OR u.phone ILIKE $${values.length})`;
    }
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM auth.users u WHERE ${where};`, values)).rows[0].n;
    const r = await query<Row>(
      `SELECT u.id,
              CASE WHEN u.email IS NULL THEN NULL
                   ELSE left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2) END AS email_masked,
              CASE WHEN coalesce(u.phone, '') = '' THEN NULL ELSE '••••' || right(u.phone, 4) END AS phone_masked,
              u.created_at, u.last_sign_in_at, ${IS_TEST} AS is_test,
              (SELECT count(*)::int FROM ol_orders oo WHERE oo.user_id = u.id) AS orders,
              (SELECT max(oo.created_at) FROM ol_orders oo WHERE oo.user_id = u.id) AS last_order_at,
              (SELECT count(*)::int FROM ol_customer_devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL) AS devices
         FROM auth.users u WHERE ${where}
        ORDER BY u.created_at DESC, u.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      values
    );
    return { customers: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },
};
