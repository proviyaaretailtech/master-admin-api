import { query } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { NotFoundException } from "../../utils/app-error";
import { pageMeta } from "../../validators/master.validator";
import { PLATFORM_CURRENCY, Row, Where } from "./common";

export interface RuleInput {
  organization_id?: string | null;
  channel?: string | null;
  pct_bps: number;
  fixed_minor: number;
  min_minor: number;
  max_minor?: number | null;
}

const COLS = `id, organization_id, channel, pct_bps, fixed_minor, min_minor, max_minor, active, effective_from, created_at`;
const withCurrency = (row: Row) => ({ ...row, currency_code: PLATFORM_CURRENCY });

async function load(id: string): Promise<Row> {
  const r = await query<Row>(`SELECT ${COLS} FROM commission_rules WHERE id = $1;`, [id]);
  if (!r.rows[0]) throw new NotFoundException("Commission rule not found");
  return r.rows[0];
}

/**
 * Commission rules are versioned in the database (0303): creating, replacing and deactivating go through the
 * master_commission_rule_* functions, which audit with the named actor and refuse to rewrite history.
 */
export const commissionService = {
  async list(f: { organization_id?: string; channel?: string; active?: boolean; page: number; limit: number }) {
    const w = new Where().add("organization_id = $?", f.organization_id).add("channel = $?", f.channel).add("active = $?", f.active);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM commission_rules ${w.sql};`, w.values)).rows[0].n;
    const rows = await query<Row>(
      `SELECT ${COLS} FROM commission_rules ${w.sql} ORDER BY active DESC, created_at DESC, id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    return { rules: rows.rows.map(withCurrency), pagination: pageMeta(total, f.page, f.limit) };
  },

  async create(actor: Actor, r: RuleInput) {
    const out = await query<{ r: { rule_id: string } }>(
      `SELECT public.master_commission_rule_create($1::uuid, $2::text, $3::int, $4::bigint, $5::bigint, $6::bigint, $7::uuid) AS r;`,
      [r.organization_id ?? null, r.channel ?? null, r.pct_bps, r.fixed_minor, r.min_minor, r.max_minor ?? null, actor.id]
    );
    return withCurrency(await load(out.rows[0].r.rule_id));
  },

  /** Versioned edit: the active rule is deactivated (kept for history) and a new row carries the merged values. */
  async replace(actor: Actor, id: string, patch: Partial<Pick<RuleInput, "pct_bps" | "fixed_minor" | "min_minor" | "max_minor">>, reason: string) {
    const old = await load(id);
    const merged = {
      pct_bps: patch.pct_bps ?? (old.pct_bps as number),
      fixed_minor: patch.fixed_minor ?? (old.fixed_minor as number),
      min_minor: patch.min_minor ?? (old.min_minor as number),
      max_minor: patch.max_minor !== undefined ? patch.max_minor : (old.max_minor as number | null),
    };
    const out = await query<{ r: { rule_id: string; changed: boolean } }>(
      `SELECT public.master_commission_rule_replace($1::uuid, $2::int, $3::bigint, $4::bigint, $5::bigint, $6::text, $7::uuid) AS r;`,
      [id, merged.pct_bps, merged.fixed_minor, merged.min_minor, merged.max_minor, reason, actor.id]
    );
    const res = out.rows[0].r;
    return { rule: withCurrency(await load(res.rule_id)), replaced_rule_id: res.changed ? id : null, changed: res.changed };
  },

  async deactivate(actor: Actor, id: string, reason: string) {
    await load(id);
    await query(`SELECT public.master_commission_rule_deactivate($1::uuid, $2::text, $3::uuid);`, [id, reason, actor.id]);
    return withCurrency(await load(id));
  },
};
