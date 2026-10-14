import { query } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { NotFoundException } from "../../utils/app-error";
import { likePattern, pageMeta } from "../../validators/master.validator";
import { Row, Where } from "./common";

type Json = Record<string, unknown>;

/** Columns a reviewer sees in the queue. Personal data is readable by platform staff only (0334). */
const LIST_COLUMNS = `a.id, a.reference, a.status, a.business_name, a.partner_type, a.business_type, a.category_family, a.category,
  a.categories, a.subcategories, a.city_id, a.outlets, a.owner_name, a.phone, a.email, a.source, a.organization_id,
  a.applicant_user_id, a.reviewed_at, a.created_at, a.updated_at`;

/**
 * Partner applications from the partner website / One Local (ol_partner_applications, migrations 0334-0338).
 * Decisions go through the database function master_partner_application_decide (0342): one transaction with a row
 * lock, so approving twice never creates two organisations and only submitted/reviewing applications can be decided.
 */
export const partnerApplicationService = {
  async list(f: { status?: string; city?: string; q?: string; page: number; limit: number }) {
    const w = new Where().add("a.status = $?", f.status).add("a.city_id = $?", f.city);
    if (f.q) {
      w.values.push(likePattern(f.q));
      const i = w.values.length;
      w.raw(`(a.business_name ILIKE $${i} OR a.owner_name ILIKE $${i} OR a.phone ILIKE $${i} OR a.email ILIKE $${i} OR a.reference ILIKE $${i})`);
    }
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM ol_partner_applications a ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT ${LIST_COLUMNS}, g.name AS organization_name
         FROM ol_partner_applications a LEFT JOIN organizations g ON g.id = a.organization_id
         ${w.sql} ORDER BY a.created_at DESC, a.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    const counts = await query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM ol_partner_applications GROUP BY status;`);
    return {
      applications: r.rows,
      counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])),
      pagination: pageMeta(total, f.page, f.limit),
    };
  },

  /** Every submitted field (the browser submit key stays internal), plus the organisation, reviewer and applicant login. */
  async get(id: string) {
    const r = await query<Row>(
      `SELECT a.id, a.reference, a.status, a.source, a.city_id, sa.name AS city_name, a.partner_type, a.business_type, a.category_family,
              a.category, a.categories, a.subcategories, a.business_name, a.outlets, a.address, a.pin_code, a.owner_name, a.phone, a.email,
              a.whatsapp_ok, a.gstin, a.fssai, a.services, a.own_delivery, a.notes, a.consent_version, a.consent_at,
              a.organization_id, g.name AS organization_name, g.control_status AS organization_status,
              a.reviewed_by, nullif(btrim(concat_ws(' ', pa.first_name, pa.last_name)), '') AS reviewed_by_name, a.reviewed_at, a.review_note,
              a.applicant_user_id, au.email AS applicant_login_email, (au.email_confirmed_at IS NOT NULL) AS applicant_login_confirmed,
              a.created_at, a.updated_at
         FROM ol_partner_applications a
         LEFT JOIN ol_service_areas sa ON sa.city_id = a.city_id
         LEFT JOIN organizations g ON g.id = a.organization_id
         LEFT JOIN platform_admins pa ON pa.user_id = a.reviewed_by
         LEFT JOIN auth.users au ON au.id = a.applicant_user_id
        WHERE a.id = $1;`,
      [id]
    );
    const app = r.rows[0];
    if (!app) throw new NotFoundException("Partner application not found");
    // The login the approval would link when the application names none (the website path never sets applicant_user_id).
    let login_match: Row | null = null;
    if (!app.applicant_user_id && app.email) {
      const m = await query<Row>(
        `SELECT (email_confirmed_at IS NOT NULL) AS confirmed FROM auth.users WHERE lower(email) = lower($1)
          ORDER BY (email_confirmed_at IS NULL), created_at LIMIT 1;`,
        [app.email]
      );
      login_match = m.rows[0] ? { found: true, confirmed: m.rows[0].confirmed } : { found: false, confirmed: false };
    }
    const history = await query<Row>(
      `SELECT id, action, actor_user_id, after, created_at FROM audit_logs
        WHERE entity_type = 'ol_partner_applications' AND entity_id = $1 ORDER BY created_at DESC LIMIT 20;`,
      [id]
    );
    return { application: app, login_match, history: history.rows };
  },

  async decide(actor: Actor, id: string, decision: "approve" | "reject", reason: string | undefined) {
    const r = await query<{ r: Json }>(`SELECT public.master_partner_application_decide($1::uuid, $2::text, $3::text, $4::uuid) AS r;`, [
      id,
      decision,
      reason ?? null,
      actor.id,
    ]);
    return r.rows[0].r;
  },
};
