import { query } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { ConflictException, NotFoundException } from "../../utils/app-error";
import { likePattern, pageMeta } from "../../validators/master.validator";
import { Row, Where, recordAudit } from "./common";
import { oneLocalAdminRequest } from "./one-local-client";

/**
 * Orders held for review (ol_order_holds, 0331). A held order never reaches its restaurant until someone decides.
 * Reads come straight from the shared database. Decisions are NOT written here: releasing must also adopt the order
 * into the restaurant's POS and dispatch it, and rejecting must cancel and refund it; that downstream work lives in
 * One Local (server/order-risk.ts decideHold), so the Master calls One Local's admin API
 * POST /api/admin/order-holds/:id {decision, note} with the staff member's own session, then audits the decision here.
 */
const SELECT = `SELECT h.id, h.order_id, h.checkout_id, h.reasons, h.status, h.created_at, h.decided_at, h.decided_by, h.note,
       nullif(btrim(concat_ws(' ', pa.first_name, pa.last_name)), '') AS decided_by_name,
       o.status AS order_status, o.payment_method, o.payment_status, o.total_minor, coalesce(o.currency_code, 'INR') AS currency_code,
       o.city_id, o.store_id, s.name AS store_name, coalesce(o.organization_id, s.organization_id) AS organization_id, g.name AS organization_name,
       o.pos_order_id, o.created_at AS order_created_at,
       (SELECT count(*)::int FROM ol_order_items i WHERE i.order_id = o.id) AS item_lines,
       (SELECT coalesce(sum(i.qty), 0)::int FROM ol_order_items i WHERE i.order_id = o.id) AS item_qty
  FROM ol_order_holds h
  JOIN ol_orders o ON o.id = h.order_id
  LEFT JOIN ol_stores s ON s.id = o.store_id
  LEFT JOIN organizations g ON g.id = coalesce(o.organization_id, s.organization_id)
  LEFT JOIN platform_admins pa ON pa.user_id = h.decided_by`;

export const orderHoldService = {
  async list(f: { status?: string; q?: string; page: number; limit: number }) {
    const w = new Where().add("h.status = $?", f.status);
    if (f.q) {
      w.values.push(likePattern(f.q));
      const i = w.values.length;
      w.raw(`(h.order_id::text ILIKE $${i} OR s.name ILIKE $${i} OR g.name ILIKE $${i} OR o.city_id ILIKE $${i})`);
    }
    const from = `FROM ol_order_holds h JOIN ol_orders o ON o.id = h.order_id LEFT JOIN ol_stores s ON s.id = o.store_id
                  LEFT JOIN organizations g ON g.id = coalesce(o.organization_id, s.organization_id)`;
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n ${from} ${w.sql};`, w.values)).rows[0].n;
    // Open holds oldest first (the queue); decided ones newest first.
    const order = f.status === "held" ? "h.created_at ASC" : "(h.status = 'held') DESC, coalesce(h.decided_at, h.created_at) DESC";
    const r = await query<Row>(`${SELECT} ${w.sql} ORDER BY ${order}, h.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`, w.values);
    const counts = await query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM ol_order_holds GROUP BY status;`);
    return { holds: r.rows, counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])), pagination: pageMeta(total, f.page, f.limit) };
  },

  async get(id: string) {
    const r = await query<Row>(`${SELECT} WHERE h.id = $1;`, [id]);
    const hold = r.rows[0];
    if (!hold) throw new NotFoundException("Order hold not found");
    const items = await query<Row>(
      `SELECT name, qty, price_minor, line_total_minor FROM ol_order_items WHERE order_id = $1 ORDER BY created_at, id;`,
      [hold.order_id]
    );
    return { hold, items: items.rows };
  },

  /**
   * Release (send the order to its restaurant) or reject (cancel and refund) through One Local. The hold must still be
   * open here; One Local re-checks under its own conditional update, so two people deciding at once cannot both win.
   */
  async decide(actor: Actor, token: string, id: string, decision: "release" | "reject", reason: string) {
    const r = await query<Row>(
      `SELECT h.id, h.order_id, h.status, coalesce(o.organization_id, s.organization_id) AS organization_id
         FROM ol_order_holds h JOIN ol_orders o ON o.id = h.order_id LEFT JOIN ol_stores s ON s.id = o.store_id WHERE h.id = $1;`,
      [id]
    );
    const hold = r.rows[0];
    if (!hold) throw new NotFoundException("Order hold not found");
    if (hold.status !== "held") throw new ConflictException(`This hold was already ${String(hold.status)}`, "order_hold_already_decided");

    const result = await oneLocalAdminRequest<{ order_id?: string; status?: string }>("POST", `/api/admin/order-holds/${id}`, token, {
      decision,
      note: reason,
    });
    await recordAudit(
      actor,
      decision === "release" ? "order_hold.released" : "order_hold.rejected",
      "ol_order_holds",
      id,
      (hold.organization_id as string | null) ?? null,
      { order_id: hold.order_id, decision, reason, status: result.status ?? null, via: "one_local_admin_api" }
    );
    return { hold_id: id, order_id: result.order_id ?? hold.order_id, status: result.status ?? (decision === "release" ? "released" : "rejected") };
  },
};
