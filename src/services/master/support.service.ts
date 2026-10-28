import { query } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { NotFoundException } from "../../utils/app-error";
import { likePattern, pageMeta } from "../../validators/master.validator";
import { Row } from "./common";

type Json = Record<string, unknown>;
export type SupportSource = "customer" | "partner";

/**
 * One inbox over customer requests (customer app) and partner requests (partner app), read from master_support_inbox
 * (0631). Every change goes through master_support_update: assign, status, internal note, all audited. Notes are
 * internal; nothing is sent to the customer or partner from here.
 */
export const supportService = {
  async list(f: { source?: SupportSource; status?: string; mine?: string; q?: string; page: number; limit: number }) {
    const values: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, v: unknown) => {
      values.push(v);
      where.push(sql.replace("$?", `$${values.length}`));
    };
    if (f.source) add("i.source = $?", f.source);
    if (f.status) add("i.status = $?", f.status);
    if (f.mine) add("i.assigned_to = $?", f.mine);
    if (f.q) {
      values.push(likePattern(f.q));
      const i = values.length;
      where.push(`(i.message ILIKE $${i} OR i.reference ILIKE $${i} OR g.name ILIKE $${i})`);
    }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const from = `FROM master_support_inbox i LEFT JOIN organizations g ON g.id = i.organization_id`;
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n ${from} ${w};`, values)).rows[0].n;
    const r = await query<Row>(
      `SELECT i.source, i.id, i.reference, i.organization_id, g.name AS organization_name, i.topic, left(i.message, 200) AS message,
              i.status, i.assigned_to, nullif(btrim(concat_ws(' ', pa.first_name, pa.last_name)), '') AS assigned_to_name,
              i.created_at, i.updated_at, i.resolved_at
         ${from} LEFT JOIN platform_admins pa ON pa.user_id = i.assigned_to
         ${w} ORDER BY (i.status = 'resolved'), i.created_at DESC, i.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      values
    );
    const counts = await query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM master_support_inbox GROUP BY status;`);
    return {
      requests: r.rows,
      counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])),
      pagination: pageMeta(total, f.page, f.limit),
    };
  },

  /** One request with its full message and its notes. Who raised it is shown as a masked email. */
  async get(source: SupportSource, id: string) {
    const r = await query<Row>(
      `SELECT i.*, g.name AS organization_name,
              nullif(btrim(concat_ws(' ', pa.first_name, pa.last_name)), '') AS assigned_to_name,
              CASE WHEN u.email IS NULL THEN NULL ELSE left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2) END AS raised_by_email
         FROM master_support_inbox i
         LEFT JOIN organizations g ON g.id = i.organization_id
         LEFT JOIN platform_admins pa ON pa.user_id = i.assigned_to
         LEFT JOIN auth.users u ON u.id = i.raised_by
        WHERE i.source = $1 AND i.id = $2;`,
      [source, id]
    );
    const request = r.rows[0];
    if (!request) throw new NotFoundException("Support request not found");
    delete request.raised_by;
    const notes = await query<Row>(
      `SELECT n.id, n.note, n.created_at, nullif(btrim(concat_ws(' ', pa.first_name, pa.last_name)), '') AS author_name
         FROM support_request_notes n LEFT JOIN platform_admins pa ON pa.user_id = n.author
        WHERE n.source = $1 AND n.request_id = $2 ORDER BY n.created_at;`,
      [source, id]
    );
    return { request, notes: notes.rows };
  },

  async update(actor: Actor, source: SupportSource, id: string, b: { status?: string; assign_to_me?: boolean; note?: string }) {
    const r = await query<{ r: Json }>(`SELECT public.master_support_update($1, $2::uuid, $3, $4::uuid, $5, $6::uuid) AS r;`, [
      source,
      id,
      b.status ?? null,
      b.assign_to_me ? actor.id : null,
      b.note ?? null,
      actor.id,
    ]);
    return r.rows[0].r;
  },
};
