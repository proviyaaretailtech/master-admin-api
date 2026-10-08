import { query } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { NotFoundException } from "../../utils/app-error";
import { likePattern, pageMeta } from "../../validators/master.validator";
import { Row, Where } from "./common";

type Json = Record<string, unknown>;

/** The invitation token is returned by the database to this trusted backend only; it never reaches the browser or a log. */
function withoutToken(r: Json): Json {
  const { token: _token, ...rest } = r;
  return { ...rest, delivery: "not_sent" };
}

export const peopleService = {
  // ----------------------------------------------------------- invitations
  async listInvitations(f: { org?: string; status?: string; q?: string; page: number; limit: number }) {
    const w = new Where().add("i.organization_id = $?", f.org);
    // pending past its expiry reads as expired even before the housekeeping job flips the row
    if (f.status === "expired") w.raw(`(i.status = 'expired' OR (i.status = 'pending' AND i.expires_at <= now()))`);
    else if (f.status === "pending") w.raw(`(i.status = 'pending' AND i.expires_at > now())`);
    else w.add("i.status = $?", f.status);
    if (f.q) {
      w.values.push(likePattern(f.q));
      w.raw(`i.email ILIKE $${w.values.length}`);
    }
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM org_invitations i ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT i.id, i.organization_id, g.name AS organization_name, i.email, i.role_id, ro.slug AS role_slug, ro.name AS role_name,
              CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status END AS status,
              i.expires_at, i.created_at, i.last_sent_at, i.send_count, i.accepted_at, i.revoked_at
         FROM org_invitations i JOIN organizations g ON g.id = i.organization_id LEFT JOIN roles ro ON ro.id = i.role_id
         ${w.sql} ORDER BY i.created_at DESC, i.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    return { invitations: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async invite(actor: Actor, b: { organization_id: string; email: string; role_slug: string }) {
    const r = await query<{ r: Json }>(`SELECT public.master_invite_user($1::uuid, $2::text, $3::text, $4::uuid) AS r;`, [b.organization_id, b.email, b.role_slug, actor.id]);
    return withoutToken(r.rows[0].r);
  },
  async resend(actor: Actor, id: string) {
    const r = await query<{ r: Json }>(`SELECT public.master_invitation_resend($1::uuid, $2::uuid) AS r;`, [id, actor.id]);
    return withoutToken(r.rows[0].r);
  },
  async revoke(actor: Actor, id: string, reason?: string) {
    const r = await query<{ r: Json }>(`SELECT public.master_invitation_revoke($1::uuid, $2::text, $3::uuid) AS r;`, [id, reason ?? null, actor.id]);
    return r.rows[0].r;
  },

  // ---------------------------------------------------------------- riders
  async setRiderStatus(actor: Actor, id: string, to: "approved" | "rejected" | "suspended", reason: string | undefined) {
    const r = await query<{ r: Json }>(`SELECT public.master_rider_set_status($1::uuid, $2::text, $3::text, $4::uuid) AS r;`, [id, to, reason ?? null, actor.id]);
    return r.rows[0].r;
  },

  async decideDeposit(actor: Actor, id: string, decision: "confirmed" | "rejected", note: string | undefined) {
    const exists = await query("SELECT 1 FROM rider_cash_deposits WHERE id = $1;", [id]);
    if (!exists.rows[0]) throw new NotFoundException("Cash deposit not found");
    const r = await query<{ r: Json }>(`SELECT public.master_cash_deposit_decide($1::uuid, $2::text, $3::text, $4::uuid) AS r;`, [id, decision, note ?? null, actor.id]);
    return r.rows[0].r;
  },
};
