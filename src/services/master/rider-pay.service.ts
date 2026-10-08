import { query } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { NotFoundException } from "../../utils/app-error";
import { PLATFORM_CURRENCY, Row } from "./common";

async function assertCity(cityId: string): Promise<Row> {
  const r = await query<Row>(
    "SELECT city_id, name, lat, lng, radius_km, active FROM ol_service_areas WHERE city_id = $1 AND deleted_at IS NULL LIMIT 1;",
    [cityId]
  );
  if (!r.rows[0]) throw new NotFoundException(`City '${cityId}' not found`, "city_not_found");
  return r.rows[0];
}

export const riderPayService = {
  async listCities(): Promise<Row[]> {
    const r = await query<Row>(
      `SELECT a.city_id, a.name, a.lat, a.lng, a.radius_km, a.active,
              (SELECT count(*)::int FROM riders r WHERE r.city_id = a.city_id) AS riders_count,
              EXISTS (SELECT 1 FROM rider_rate_cards c WHERE c.city_id = a.city_id AND c.active) AS has_rate_card
         FROM ol_service_areas a WHERE a.deleted_at IS NULL ORDER BY a.name;`
    );
    return r.rows;
  },

  async getRateCard(cityId: string) {
    const city = await assertCity(cityId);
    const active = await query<Row>(
      `SELECT id, city_id, base_minor, per_km_minor, min_minor, currency_code, active, effective_from, created_at
         FROM rider_rate_cards WHERE city_id = $1 AND active LIMIT 1;`,
      [cityId]
    );
    const history = await query<Row>(
      `SELECT id, base_minor, per_km_minor, min_minor, currency_code, active, effective_from, created_at
         FROM rider_rate_cards WHERE city_id = $1 ORDER BY created_at DESC, id LIMIT 20;`,
      [cityId]
    );
    return { city, rate_card: active.rows[0] ?? null, history: history.rows };
  },

  /** Rate cards are versioned in the database (0303): a change retires the active card and inserts a new row. */
  async putRateCard(
    actor: Actor,
    cityId: string,
    input: { base_minor: number; per_km_minor: number; min_minor: number; active: boolean; reason?: string }
  ) {
    await assertCity(cityId);
    await query(
      `SELECT public.master_rider_rate_card_set($1::text, $2::bigint, $3::bigint, $4::bigint, $5::boolean, $6::text, $7::uuid);`,
      [cityId, input.base_minor, input.per_km_minor, input.min_minor, input.active, input.reason ?? null, actor.id]
    );
    const cur = await this.getRateCard(cityId);
    return { rate_card: cur.rate_card, currency_code: PLATFORM_CURRENCY };
  },

  async getPolicy(cityId: string) {
    const city = await assertCity(cityId);
    const r = await query<Row>(
      `SELECT city_id, withdraw_min_minor, withdraw_max_minor, withdraw_per_day, default_cash_limit_minor, unavailable_wait_seconds, updated_at
         FROM rider_policies WHERE city_id = $1;`,
      [cityId]
    );
    return { city, currency_code: PLATFORM_CURRENCY, policy: r.rows[0] ?? null };
  },

  async putPolicy(
    actor: Actor,
    cityId: string,
    p: {
      withdraw_min_minor: number;
      withdraw_max_minor: number;
      withdraw_per_day: number;
      default_cash_limit_minor: number;
      unavailable_wait_seconds: number;
    }
  ) {
    await assertCity(cityId);
    await query(
      `SELECT public.master_rider_policy_set($1::text, $2::bigint, $3::bigint, $4::int, $5::bigint, $6::int, $7::uuid);`,
      [cityId, p.withdraw_min_minor, p.withdraw_max_minor, p.withdraw_per_day, p.default_cash_limit_minor, p.unavailable_wait_seconds, actor.id]
    );
    const cur = await this.getPolicy(cityId);
    return { currency_code: PLATFORM_CURRENCY, policy: cur.policy };
  },
};
