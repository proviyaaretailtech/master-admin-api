import "dotenv/config";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { buildPoolConfig } from "../config/database.config";

/**
 * Creates (or promotes) a platform administrator: a Supabase auth user plus an Active
 * platform_admins row holding the system `super_admin` role.
 *
 *   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' npm run bootstrap:admin
 *
 * The password is read from the environment only (never hard-coded, never printed). Optional:
 * ADMIN_FIRST_NAME, ADMIN_LAST_NAME. Uses SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL.
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || password.length < 10) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 10 characters).");
    process.exit(1);
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL) {
    console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL must be set.");
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // Same connection settings as the API (pooler rewrite for db.<ref>.supabase.co, which is IPv6-only;
  // certificate-verified SSL for a hosted database), see config/database.config.ts
  const pool = new Pool(buildPoolConfig(DATABASE_URL));
  try {
    const role = await pool.query<{ id: string }>("SELECT id FROM platform_roles WHERE key = 'super_admin';");
    if (role.rows.length === 0) throw new Error("platform_roles has no super_admin role: apply the shared database migrations first.");

    const existing = await pool.query<{ id: string }>("SELECT id FROM auth.users WHERE lower(email) = $1;", [email]);
    let userId = existing.rows[0]?.id;
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(error?.message || "could not create the auth user");
      userId = data.user.id;
    }
    await pool.query(
      `INSERT INTO platform_admins (user_id, role_id, first_name, last_name, status)
       VALUES ($1, $2, $3, $4, 'Active')
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = 'Active';`,
      [userId, role.rows[0].id, process.env.ADMIN_FIRST_NAME || "Platform", process.env.ADMIN_LAST_NAME || "Admin"]
    );
    console.log(`Platform admin ready: ${email} (user ${userId})`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
