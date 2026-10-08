import { query, queryAs, txAs } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { ConflictException, NotFoundException } from "../../utils/app-error";
import { Row, recordAudit } from "./common";

async function payoutOr404(id: string): Promise<Row> {
  const r = await query<Row>(`SELECT id, status, settlement_id, organization_id FROM payouts WHERE id = $1;`, [id]);
  if (!r.rows[0]) throw new NotFoundException("Payout not found");
  return r.rows[0];
}

const PAYOUT_COLS = `id, organization_id, payee_type, payee_id, settlement_id, amount_minor, currency_code, status, reference, created_at, updated_at`;

/**
 * finance_run_settlement / finance_approve_settlement (0119) accept a signed-in caller only when they are a
 * super admin, or a server context (no JWT subject). A super admin is attributed through the JWT subject; any other
 * staff member holding the finance permission runs in server context and is attributed by an explicit audit row
 * (see db-requests-backend.md: p_actor variants would remove this branch).
 */
async function financeFn<T extends Row>(actor: Actor, sql: string, params: unknown[]) {
  return actor.isSuperAdmin ? queryAs<T>(actor.id, sql, params) : query<T>(sql, params);
}

export const financeService = {
  async runSettlement(actor: Actor, b: { organization_id: string; period_start: string; period_end: string }) {
    const org = await query("SELECT 1 FROM organizations WHERE id = $1;", [b.organization_id]);
    if (!org.rows[0]) throw new NotFoundException("Organization not found");
    const r = await financeFn<{ id: string }>(actor, `SELECT public.finance_run_settlement($1::uuid, $2::date, $3::date) AS id;`, [
      b.organization_id,
      b.period_start,
      b.period_end,
    ]);
    if (!actor.isSuperAdmin) {
      await recordAudit(actor, "master.settlement_run", "settlements", r.rows[0].id as string, b.organization_id, { period_start: b.period_start, period_end: b.period_end });
    }
    const s = await query<Row>(
      `SELECT id, organization_id, period_start, period_end, status, currency_code, gross_minor, commission_minor, tax_minor, net_minor, reversal_minor, carry_in_minor, carry_out_minor, created_at
         FROM settlements WHERE id = $1;`,
      [r.rows[0].id]
    );
    return s.rows[0];
  },

  async approveSettlement(actor: Actor, id: string) {
    const exists = await query("SELECT 1 FROM settlements WHERE id = $1;", [id]);
    if (!exists.rows[0]) throw new NotFoundException("Settlement not found");
    const r = await financeFn<{ payout_id: string | null }>(actor, `SELECT public.finance_approve_settlement($1::uuid) AS payout_id;`, [id]);
    if (!actor.isSuperAdmin) {
      await recordAudit(actor, "master.settlement_approved", "settlements", id, null, { payout_id: r.rows[0].payout_id });
    }
    const s = await query<Row>(`SELECT id, organization_id, period_start, period_end, status, currency_code, gross_minor, commission_minor, net_minor FROM settlements WHERE id = $1;`, [id]);
    return { settlement: s.rows[0], payout_id: r.rows[0].payout_id };
  },

  async approvePayout(actor: Actor, id: string) {
    const cur = await payoutOr404(id);
    if (cur.status !== "pending") throw new ConflictException(`Payout is ${cur.status}; only a pending payout can be approved`, "finance_wrong_state");
    const r = await queryAs<Row>(actor.id, `UPDATE payouts SET status = 'approved' WHERE id = $1 AND status = 'pending' RETURNING ${PAYOUT_COLS};`, [id]);
    if (!r.rows[0]) throw new ConflictException("Payout changed state; reload and retry", "finance_wrong_state");
    return r.rows[0];
  },

  async markPaid(actor: Actor, id: string, reference: string) {
    const cur = await payoutOr404(id);
    if (cur.status !== "approved") throw new ConflictException(`Payout is ${cur.status}; only an approved payout can be marked paid`, "finance_wrong_state");
    return txAs(actor.id, async (c) => {
      const r = await c.query<Row>(`UPDATE payouts SET status = 'paid', reference = $2 WHERE id = $1 AND status = 'approved' RETURNING ${PAYOUT_COLS};`, [id, reference]);
      if (!r.rows[0]) throw new ConflictException("Payout changed state; reload and retry", "finance_wrong_state");
      const sid = r.rows[0].settlement_id as string | null;
      if (sid) {
        // a settlement is paid once every payout it produced is paid
        await c.query(
          `UPDATE settlements SET status = 'paid' WHERE id = $1 AND status = 'approved'
             AND NOT EXISTS (SELECT 1 FROM payouts WHERE settlement_id = $1 AND status <> 'paid');`,
          [sid]
        );
      }
      return r.rows[0];
    });
  },
};
