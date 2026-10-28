import { query } from "../../config/database.config";
import { NotFoundException } from "../../utils/app-error";
import { likePattern, pageMeta } from "../../validators/master.validator";
import { Row, Where, scrub } from "./common";

const maskPhone = (p: unknown) => (typeof p === "string" && p.length > 4 ? `${"*".repeat(p.length - 4)}${p.slice(-4)}` : p);
const page = (p: number, l: number) => `LIMIT ${l} OFFSET ${(p - 1) * l}`;

export const readService = {
  // ---------------------------------------------------------------- audit
  async auditLogs(f: {
    actor?: string;
    entity_type?: string;
    entity_id?: string;
    org?: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const w = new Where()
      .add("a.actor_user_id = $?", f.actor)
      .add("a.entity_type = $?", f.entity_type)
      .add("a.entity_id = $?", f.entity_id)
      .add("a.organization_id = $?", f.org)
      .add("a.created_at >= $?::timestamptz", f.from)
      .add("a.created_at < $?::timestamptz", f.to);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs a ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT a.id, a.organization_id, a.actor_user_id,
              nullif(btrim(coalesce(pa.first_name,'') || ' ' || coalesce(pa.last_name,'')), '') AS actor_name,
              a.actor_db_role, a.action, a.entity_type, a.entity_id, a.before, a.after, a.created_at
         FROM audit_logs a LEFT JOIN platform_admins pa ON pa.user_id = a.actor_user_id
         ${w.sql} ORDER BY a.created_at DESC, a.id DESC ${page(f.page, f.limit)};`,
      w.values
    );
    return { logs: r.rows.map((row) => scrub(row)), pagination: pageMeta(total, f.page, f.limit) };
  },

  // --------------------------------------------------------------- riders
  async riders(f: { status?: string; city?: string; q?: string; page: number; limit: number }) {
    const w = new Where().add("r.status = $?", f.status).add("r.city_id = $?", f.city);
    if (f.q) {
      w.values.push(likePattern(f.q));
      const i = w.values.length;
      w.raw(`(r.full_name ILIKE $${i} OR r.phone ILIKE $${i} OR r.email ILIKE $${i})`);
    }
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM riders r ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT r.id, r.full_name, r.phone, r.email, r.type, r.status, r.vehicle, r.city_id, r.zone_id, r.organization_id,
              r.cash_limit_minor, r.onboarding_step, r.submitted_at, r.reviewed_at, r.created_at,
              (SELECT online FROM rider_availability av WHERE av.rider_id = r.id) AS online
         FROM riders r ${w.sql} ORDER BY coalesce(r.submitted_at, r.created_at) DESC, r.id ${page(f.page, f.limit)};`,
      w.values
    );
    return { riders: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async rider360(id: string) {
    const r = await query<Row>(`SELECT * FROM riders WHERE id = $1;`, [id]);
    if (!r.rows[0]) throw new NotFoundException("Rider not found");
    const [docs, avail, hub, earn, cash, deposits, jobs, payouts, cashHand] = await Promise.all([
      query<Row>(
        `SELECT id, kind, number_masked, source, status, expires_at, rejection_reason, reviewed_at, created_at FROM rider_documents WHERE rider_id = $1 ORDER BY created_at DESC;`,
        [id]
      ),
      query<Row>(`SELECT online, lat, lng, last_seen_at FROM rider_availability WHERE rider_id = $1;`, [id]),
      query<Row>(`SELECT zone_id, lat, lng, address, landmark FROM rider_hubs WHERE rider_id = $1;`, [id]),
      query<Row>(
        `SELECT currency_code, kind, count(*)::int AS entries, coalesce(sum(amount_minor),0)::bigint AS amount_minor,
                coalesce(sum(amount_minor) FILTER (WHERE payout_id IS NULL),0)::bigint AS unpaid_minor
           FROM rider_earnings WHERE rider_id = $1 GROUP BY currency_code, kind;`,
        [id]
      ),
      query<Row>(`SELECT id, kind, amount_minor, currency_code, reference, created_at FROM rider_cash_entries WHERE rider_id = $1 ORDER BY created_at DESC LIMIT 20;`, [id]),
      query<Row>(`SELECT id, amount_minor, currency_code, status, reference, created_at FROM rider_cash_deposits WHERE rider_id = $1 ORDER BY created_at DESC LIMIT 20;`, [id]),
      query<Row>(
        `SELECT id, order_no, status, step, city_id, created_at, delivered_at FROM delivery_jobs WHERE rider_id = $1 ORDER BY created_at DESC LIMIT 10;`,
        [id]
      ),
      query<Row>(`SELECT id, amount_minor, currency_code, status, reference, created_at FROM payouts WHERE payee_type = 'rider' AND payee_id = $1 ORDER BY created_at DESC LIMIT 10;`, [id]),
      query<{ v: string }>(`SELECT public.rider_cash_in_hand_minor($1)::text AS v;`, [id]),
    ]);
    const rider = r.rows[0];
    return {
      rider,
      documents: docs.rows,
      availability: avail.rows[0] ?? null,
      hub: hub.rows[0] ?? null,
      earnings: earn.rows,
      cash: { in_hand_minor: Number(cashHand.rows[0].v), currency_code: "INR", entries: cash.rows },
      deposits: deposits.rows,
      recent_jobs: jobs.rows,
      payouts: payouts.rows,
    };
  },

  async cashDeposits(f: { status?: string; rider_id?: string; page: number; limit: number }) {
    const w = new Where().add("d.status = $?", f.status).add("d.rider_id = $?", f.rider_id);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM rider_cash_deposits d ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT d.id, d.rider_id, r.full_name AS rider_name, d.amount_minor, d.currency_code, d.status, d.reference, d.created_at, d.updated_at
         FROM rider_cash_deposits d JOIN riders r ON r.id = d.rider_id
         ${w.sql} ORDER BY d.created_at DESC, d.id ${page(f.page, f.limit)};`,
      w.values
    );
    return { deposits: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  // --------------------------------------------------------------- orders
  async orders(f: { org?: string; status?: string; channel?: string; q?: string; from?: string; to?: string; page: number; limit: number }) {
    const w = new Where()
      .add("o.organization_id = $?", f.org)
      .add("o.status = $?", f.status)
      .add("o.channel = $?", f.channel)
      .add("o.created_at >= $?::timestamptz", f.from)
      .add("o.created_at < $?::timestamptz", f.to);
    if (f.q) {
      w.values.push(likePattern(f.q));
      const i = w.values.length;
      w.raw(`(o.display_no ILIKE $${i} OR o.customer_name ILIKE $${i} OR o.customer_phone ILIKE $${i} OR o.external_ref ILIKE $${i} OR o.id::text ILIKE $${i})`);
    }
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM orders o ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT o.id, o.organization_id, g.name AS organization_name, o.location_id, o.display_no, o.channel, o.status, o.customer_name, o.customer_phone,
              o.subtotal_minor, o.discount_minor, o.gst_amount_minor, o.total_minor, o.currency_code, o.payment_method, o.paid_at, o.created_at
         FROM orders o JOIN organizations g ON g.id = o.organization_id
         ${w.sql} ORDER BY o.created_at DESC, o.id ${page(f.page, f.limit)};`,
      w.values
    );
    return { orders: r.rows.map((o) => ({ ...o, customer_phone: maskPhone(o.customer_phone) })), pagination: pageMeta(total, f.page, f.limit) };
  },

  /** Read-only Order 360: the canonical order_trace plus one merged, time-ordered timeline. */
  async order360(id: string) {
    const t = await query<{ trace: Row }>(`SELECT public.order_trace($1) AS trace;`, [id]);
    const trace = t.rows[0]?.trace ?? {};
    if (!trace.order) throw new NotFoundException("Order not found");
    const jobIds = ((trace.delivery_jobs as Row[]) ?? []).map((j) => j.id as string);
    const dev = jobIds.length
      ? await query<Row>(`SELECT id, job_id, kind, meta, created_at FROM delivery_events WHERE job_id = ANY($1::uuid[]) ORDER BY created_at;`, [jobIds])
      : { rows: [] as Row[] };
    const timeline = [
      ...((trace.order_events as Row[]) ?? []).map((e) => ({ at: e.created_at, source: "order", kind: e.kind ?? e.event_type ?? e.type ?? "event", detail: e })),
      ...((trace.payments as Row[]) ?? []).map((p) => ({ at: p.created_at, source: "payment", kind: `payment.${String(p.method ?? "")}`, detail: { id: p.id, amount_minor: p.amount_minor, currency_code: p.currency_code, method: p.method } })),
      ...dev.rows.map((e) => ({ at: e.created_at, source: "delivery", kind: e.kind, detail: e.meta })),
      // receipts from the event log (0590): every step on both sides of the order, with the app and pipe it came through
      ...((trace.events as Row[]) ?? []).map((e) => ({
        at: e.occurred_at,
        source: "event",
        kind: e.event_type,
        detail: { app: e.source, via: e.via, idempotency_key: e.idempotency_key, payload: e.payload },
      })),
    ].sort((a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime());
    const cleaned = scrub(trace);
    for (const c of (cleaned.consumer_orders as Row[]) ?? []) {
      delete c.customer_hash;
      delete c.razorpay_order_id;
      delete c.razorpay_payment_id;
    }
    return { ...cleaned, timeline: scrub(timeline) };
  },

  // ------------------------------------------------------------- dispatch
  async dispatchJobs(f: { status?: string; org?: string; page: number; limit: number }) {
    const w = new Where().add("j.status = $?", f.status).add("j.organization_id = $?", f.org);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM delivery_jobs j ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT j.id, j.ol_order_id, j.organization_id, g.name AS organization_name, j.store_id, j.city_id, j.status, j.step, j.version,
              j.rider_id, r.full_name AS rider_name, j.payment_mode, j.cash_to_collect_minor, j.currency_code, j.pickup_name, j.drop_area,
              j.order_no, j.promised_by, j.exception_kind, j.picked_up_at, j.delivered_at, j.created_at, j.updated_at,
              (SELECT count(*)::int FROM delivery_exceptions x WHERE x.job_id = j.id AND x.status = 'open') AS open_exceptions
         FROM delivery_jobs j LEFT JOIN organizations g ON g.id = j.organization_id LEFT JOIN riders r ON r.id = j.rider_id
         ${w.sql} ORDER BY j.created_at DESC, j.id ${page(f.page, f.limit)};`,
      w.values
    );
    return { jobs: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async dispatchJob(id: string) {
    const j = await query<Row>(
      `SELECT j.id, j.ol_order_id, j.pos_order_id, j.organization_id, g.name AS organization_name, j.store_id, j.city_id, j.status, j.step, j.version,
              j.rider_id, r.full_name AS rider_name, j.payment_mode, j.cash_to_collect_minor, j.currency_code, j.items_count, j.temperature, j.vehicle,
              j.prep_minutes, j.promised_by, j.order_no, j.pickup_name, j.pickup_address, j.pickup_lat, j.pickup_lng, j.drop_area, j.drop_lat, j.drop_lng,
              j.dispatch_trigger, j.released_at, j.escalated_at, j.cancel_reason, j.exception_kind, j.picked_up_at, j.delivered_at, j.created_at, j.updated_at
         FROM delivery_jobs j LEFT JOIN organizations g ON g.id = j.organization_id LEFT JOIN riders r ON r.id = j.rider_id WHERE j.id = $1;`,
      [id]
    );
    if (!j.rows[0]) throw new NotFoundException("Delivery job not found");
    const [assign, ex, ev] = await Promise.all([
      query<Row>(`SELECT id, rider_id, round, offered_at, expires_at, outcome, reason, answered_at FROM delivery_assignments WHERE job_id = $1 ORDER BY offered_at;`, [id]),
      query<Row>(`SELECT id, rider_id, kind, note, status, outcome, resolved_note, resolved_by, created_at, resolved_at FROM delivery_exceptions WHERE job_id = $1 ORDER BY created_at;`, [id]),
      query<Row>(`SELECT id, kind, meta, created_at FROM delivery_events WHERE job_id = $1 ORDER BY created_at, id;`, [id]),
    ]);
    return { job: j.rows[0], assignments: assign.rows, exceptions: ex.rows, timeline: scrub(ev.rows) };
  },

  async exceptionJob(exceptionId: string): Promise<Row> {
    const r = await query<Row>(`SELECT x.id, x.job_id, x.status, j.organization_id FROM delivery_exceptions x JOIN delivery_jobs j ON j.id = x.job_id WHERE x.id = $1;`, [exceptionId]);
    if (!r.rows[0]) throw new NotFoundException("Exception not found");
    return r.rows[0];
  },

  // -------------------------------------------------------------- finance
  async payments(f: { org?: string; method?: string; from?: string; to?: string; page: number; limit: number }) {
    const w = new Where()
      .add("p.organization_id = $?", f.org)
      .add("p.method = $?", f.method)
      .add("p.created_at >= $?::timestamptz", f.from)
      .add("p.created_at < $?::timestamptz", f.to);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM payments p ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT p.id, p.organization_id, g.name AS organization_name, p.order_id, p.method, p.amount_minor, p.currency_code, p.reference, p.gateway, p.gateway_reference, p.created_at
         FROM payments p JOIN organizations g ON g.id = p.organization_id
         ${w.sql} ORDER BY p.created_at DESC, p.id ${page(f.page, f.limit)};`,
      w.values
    );
    return { payments: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async settlements(f: { org?: string; status?: string; page: number; limit: number }) {
    const w = new Where().add("s.organization_id = $?", f.org).add("s.status = $?", f.status);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM settlements s ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT s.id, s.organization_id, g.name AS organization_name, s.period_start, s.period_end, s.status, s.currency_code, s.gross_minor,
              s.food_due_minor, s.clawback_minor, s.commission_minor, s.commission_gst_minor, s.commission_gst_bps, s.debt_in_minor, s.debt_out_minor,
              s.net_minor, s.delivery_fee_minor, s.tax_minor, s.reversal_minor, s.carry_in_minor, s.carry_out_minor, s.created_at, s.updated_at,
              (SELECT count(*)::int FROM payouts p WHERE p.settlement_id = s.id) AS payouts_count
         FROM settlements s JOIN organizations g ON g.id = s.organization_id
         ${w.sql} ORDER BY s.created_at DESC, s.id ${page(f.page, f.limit)};`,
      w.values
    );
    return { settlements: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async payouts(f: { status?: string; payee_type?: string; org?: string; page: number; limit: number }) {
    const w = new Where().add("p.status = $?", f.status).add("p.payee_type = $?", f.payee_type).add("p.organization_id = $?", f.org);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM payouts p ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT p.id, p.organization_id, g.name AS organization_name, p.payee_type, p.payee_id, p.settlement_id, p.amount_minor, p.currency_code,
              p.status, p.reference, p.created_at, p.updated_at
         FROM payouts p LEFT JOIN organizations g ON g.id = p.organization_id
         ${w.sql} ORDER BY p.created_at DESC, p.id ${page(f.page, f.limit)};`,
      w.values
    );
    return { payouts: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async ledger(f: { order_id?: string; type?: string; org?: string; source?: string; page: number; limit: number }) {
    const w = (alias: string) =>
      new Where().add(`${alias}.order_id = $?`, f.order_id).add(`${alias}.entry_type = $?`, f.type).add(`${alias}.organization_id = $?`, f.org);
    const parts: string[] = [];
    let values: unknown[] = [];
    if (!f.source || f.source === "commission") {
      const c = w("l");
      parts.push(`SELECT 'commission'::text AS source, l.id::text AS id, l.organization_id, l.order_id, l.entry_type, l.party_type AS direction, l.amount_minor, l.currency_code, l.memo, l.created_at FROM commission_ledger l ${c.sql}`);
      values = c.values;
    }
    if (!f.source || f.source === "payment") {
      const p = w("l");
      // renumber placeholders for the second branch
      const offset = values.length;
      const sql = `SELECT 'payment'::text AS source, l.id::text AS id, l.organization_id, l.order_id, l.entry_type, l.direction, l.amount_minor, l.currency_code, l.memo, l.created_at FROM payment_ledger l ${p.sql}`.replace(
        /\$(\d+)/g,
        (_m, n) => `$${Number(n) + offset}`
      );
      parts.push(sql);
      values = [...values, ...p.values];
    }
    const union = parts.join(" UNION ALL ");
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM (${union}) u;`, values)).rows[0].n;
    const r = await query<Row>(`SELECT * FROM (${union}) u ORDER BY created_at DESC, id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`, values);
    return { entries: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async reconciliation() {
    const [ex, inv, tot] = await Promise.all([
      query<Row>(
        `SELECT id, organization_id, kind, order_id, payment_id, gateway_reference, expected_minor, actual_minor, status, detected_at, last_seen_at, resolved_at, resolution
           FROM payment_reconciliation_exceptions WHERE status <> 'resolved' ORDER BY detected_at DESC LIMIT 100;`
      ),
      query<Row>(`SELECT id, code, ref, detail, first_seen_at, last_seen_at FROM invariant_violations WHERE resolved_at IS NULL ORDER BY last_seen_at DESC LIMIT 100;`),
      query<Row>(
        `SELECT (SELECT count(*)::int FROM payment_reconciliation_exceptions WHERE status <> 'resolved') AS open_payment_exceptions,
                (SELECT count(*)::int FROM invariant_violations WHERE resolved_at IS NULL) AS open_invariant_violations,
                (SELECT count(*)::int FROM settlements WHERE status = 'draft') AS draft_settlements,
                (SELECT count(*)::int FROM payouts WHERE status IN ('pending','approved')) AS open_payouts;`
      ),
    ]);
    return { totals: tot.rows[0], payment_exceptions: ex.rows, invariant_violations: inv.rows };
  },

  async riderEarnings(f: { from?: string; to?: string; rider_id?: string; page: number; limit: number }) {
    const w = new Where().add("e.rider_id = $?", f.rider_id).add("e.created_at >= $?::timestamptz", f.from).add("e.created_at < $?::timestamptz", f.to);
    const total = (await query<{ n: number }>(`SELECT count(DISTINCT (e.rider_id, e.currency_code))::int AS n FROM rider_earnings e ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT e.rider_id, r.full_name AS rider_name, r.city_id, e.currency_code, count(*)::int AS entries,
              coalesce(sum(e.amount_minor),0)::bigint AS earned_minor,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.payout_id IS NULL),0)::bigint AS unpaid_minor,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.payout_id IS NOT NULL),0)::bigint AS paid_minor
         FROM rider_earnings e JOIN riders r ON r.id = e.rider_id
         ${w.sql} GROUP BY e.rider_id, r.full_name, r.city_id, e.currency_code
         ORDER BY earned_minor DESC, e.rider_id ${page(f.page, f.limit)};`,
      w.values
    );
    return { rider_earnings: r.rows.map((x) => ({ ...x, earned_minor: Number(x.earned_minor), unpaid_minor: Number(x.unpaid_minor), paid_minor: Number(x.paid_minor) })), pagination: pageMeta(total, f.page, f.limit) };
  },
};
