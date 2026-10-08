import { query } from "../../config/database.config";
import { Env } from "../../config/env.config";
import { Actor, actorCan } from "../../utils/authz";
import { UserModel } from "../../@types/express";
import { Row } from "./common";

export function environmentLabel(): string {
  const explicit = (process.env.APP_ENV ?? "").trim().toLowerCase();
  if (explicit) return explicit.slice(0, 20);
  return Env.NODE_ENV === "production" ? "production" : Env.NODE_ENV === "test" ? "test" : "local";
}

export const shellService = {
  async context(user: UserModel, actor: Actor) {
    const orgs = await query<Row>(`SELECT id, name, control_status AS status FROM organizations ORDER BY name LIMIT 200;`);
    const pending = await query<{ n: number }>(`SELECT count(*)::int AS n FROM approval_requests WHERE status = 'pending';`);
    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        status: user.status,
        role: user.role_details ? { id: user.role_details.id, name: user.role_details.name, key: user.role_details.key } : null,
      },
      is_super_admin: actor.isSuperAdmin,
      permissions: (user.permissions ?? [])
        .filter((f) => f.accessLevel !== "none")
        .map((f) => ({ id: f.id, access_level: f.accessLevel, actions: f.actions.filter((a) => a.enabled).map((a) => a.key) })),
      environment: environmentLabel(),
      organizations: orgs.rows,
      pending_actions: { approvals: pending.rows[0].n },
    };
  },

  async systemStatus() {
    const t0 = Date.now();
    const checks = await Promise.allSettled([
      query(`SELECT 1;`),
      query<Row>(
        `SELECT count(*)::int AS backlog, coalesce(extract(epoch FROM now() - min(occurred_at))::int, 0) AS oldest_seconds
           FROM domain_events WHERE published_at IS NULL;`
      ),
      query<Row>(
        `SELECT count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status IN ('queued','running'))::int AS in_flight,
                max(finished_at) AS last_finished_at FROM pos_sync_jobs WHERE created_at > now() - interval '24 hours';`
      ),
      query<Row>(`SELECT count(*)::int AS n FROM approval_requests WHERE status = 'pending';`),
      query<Row>(`SELECT count(*)::int AS n FROM invariant_violations WHERE resolved_at IS NULL;`),
    ]);
    const ok = (i: number) => (checks[i].status === "fulfilled" ? (checks[i] as PromiseFulfilledResult<{ rows: Row[] }>).value.rows[0] : null);
    return {
      environment: environmentLabel(),
      checked_at: new Date().toISOString(),
      db: { ok: checks[0].status === "fulfilled", latency_ms: Date.now() - t0 },
      queue: ok(1) ? { backlog: ok(1)!.backlog, oldest_seconds: ok(1)!.oldest_seconds } : null,
      sync: ok(2),
      pending_approvals: ok(3)?.n ?? null,
      open_invariant_violations: ok(4)?.n ?? null,
    };
  },

  /** Grouped global search (master_search, 0306). A group appears only when the staff member may view that area. */
  async search(actor: Actor, q: string, limit = 5) {
    const r = await query<{ r: Record<string, unknown> }>(`SELECT public.master_search($1::text, $2::int) AS r;`, [q, limit]);
    const all = r.rows[0].r;
    const allowed: Record<string, boolean> = {
      organizations: actorCan(actor, "feat_org_360", "view_directory"),
      users: actorCan(actor, "feat_org_360", "view_directory"),
      riders: actorCan(actor, "feat_riders", "view_riders"),
      orders: actorCan(actor, "feat_orders", "view_orders"),
      payouts: actorCan(actor, "feat_finance", "view_finance"),
      settlements: actorCan(actor, "feat_finance", "view_finance"),
    };
    const results: Record<string, unknown> = {};
    for (const g of Object.keys(allowed)) results[g] = allowed[g] ? (all[g] ?? []) : [];
    return { query: q, results };
  },

  async dashboard(f: { from?: string; to?: string; org?: string }) {
    const r = await query<{ r: Record<string, unknown> }>(`SELECT public.dashboard_summary($1::timestamptz, $2::timestamptz, $3::uuid) AS r;`, [f.from ?? null, f.to ?? null, f.org ?? null]);
    return r.rows[0].r;
  },

  async financeOverview(f: { from?: string; to?: string }) {
    const r = await query<{ r: Record<string, unknown> }>(`SELECT public.finance_overview($1::timestamptz, $2::timestamptz) AS r;`, [f.from ?? null, f.to ?? null]);
    return r.rows[0].r;
  },
};
