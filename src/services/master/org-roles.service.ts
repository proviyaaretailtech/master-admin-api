import { randomBytes } from "node:crypto";
import { query } from "../../config/database.config";
import { supabaseAdmin } from "../../config/supabase.config";
import { Env } from "../../config/env.config";
import { Actor } from "../../utils/authz";
import { BadRequestException, ForbiddenException, NotFoundException } from "../../utils/app-error";
import { Row } from "./common";

type Json = Record<string, unknown>;
export const STORE_TYPES = ["restaurant", "store", "service", "logistic"] as const;

/** A test login is never made where real partners sign in. */
const isProduction = () => Env.NODE_ENV === "production" || process.env.APP_ENV === "production";

/**
 * Role sets per store type (0632), decided by the founder in Master and empty until then, and what an organisation
 * was given. Test logins (0633) let a super admin try the partner app as a business, outside production only.
 */
export const orgRolesService = {
  /** Every role that can go in a set, and which store types have it. */
  async roleSets() {
    const roles = await query<Row>(`SELECT slug, name, description FROM roles WHERE slug <> 'org_owner' ORDER BY name;`);
    const sets = await query<Row>(
      `SELECT s.store_type, s.role_slug, s.added_at, nullif(btrim(concat_ws(' ', pa.first_name, pa.last_name)), '') AS added_by_name
         FROM platform_role_sets s LEFT JOIN platform_admins pa ON pa.user_id = s.added_by ORDER BY s.store_type, s.role_slug;`
    );
    return { store_types: STORE_TYPES, roles: roles.rows, sets: sets.rows };
  },

  async changeSet(actor: Actor, storeType: string, role: string, add: boolean) {
    const r = await query<{ r: Json }>(`SELECT public.master_role_set_change($1, $2, $3, $4::uuid) AS r;`, [storeType, role, add, actor.id]);
    return r.rows[0].r;
  },

  /** The roles an organisation was given, who holds each role there (email masked), and its test logins. */
  async forOrganization(org: string) {
    const exists = await query(`SELECT 1 FROM organizations WHERE id = $1;`, [org]);
    if (!exists.rowCount) throw new NotFoundException("Organisation not found");
    const grants = await query<Row>(
      `SELECT g.role_slug, r.name AS role_name, g.store_type, g.granted_at FROM org_role_grants g JOIN roles r ON r.slug = g.role_slug
        WHERE g.organization_id = $1 ORDER BY r.name;`,
      [org]
    );
    const members = await query<Row>(
      `SELECT r.slug AS role_slug, r.name AS role_name, ou.status,
              left(split_part(ou.email, '@', 1), 2) || '***@' || split_part(ou.email, '@', 2) AS email_masked,
              EXISTS (SELECT 1 FROM test_logins t WHERE t.user_id = ou.user_id) AS is_test
         FROM org_users ou JOIN roles r ON r.id = ou.role_id
        WHERE ou.organization_id = $1 ORDER BY r.name, ou.created_at;`,
      [org]
    );
    return { grants: grants.rows, members: members.rows, test_logins_allowed: !isProduction() };
  },

  async applySet(actor: Actor, org: string, storeType: string) {
    const r = await query<{ r: Json }>(`SELECT public.master_org_apply_role_set($1::uuid, $2, $3::uuid) AS r;`, [org, storeType, actor.id]);
    return r.rows[0].r;
  },

  /**
   * Makes a login on a test domain with a random password, then records it and makes it a member in one database step.
   * The password is returned once and never stored by Master. If the database step fails, the login is removed again.
   */
  async createTestLogin(actor: Actor, org: string, role: string) {
    if (isProduction()) throw new ForbiddenException("Test logins are never created in production");
    const slug = (await query<{ slug: string }>(`SELECT slug FROM organizations WHERE id = $1;`, [org])).rows[0]?.slug;
    if (!slug) throw new NotFoundException("Organisation not found");
    const email = `test+${slug.replace(/[^a-z0-9-]/gi, "").slice(0, 30)}-${randomBytes(3).toString("hex")}@proviyaa.test`;
    const password = randomBytes(9).toString("base64url");
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { is_test: true },
    } as never);
    if (error || !data?.user) throw new BadRequestException("Could not create the test login");
    try {
      const r = await query<{ r: Json }>(`SELECT public.master_org_add_test_member($1::uuid, $2::uuid, $3, $4::uuid) AS r;`, [
        org,
        data.user.id,
        role,
        actor.id,
      ]);
      return { ...r.rows[0].r, email, password };
    } catch (err) {
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      throw err;
    }
  },
};
