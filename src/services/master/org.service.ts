import { query } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { BadRequestException, NotFoundException } from "../../utils/app-error";
import { CreateOrganizationInput } from "../../validators/organization.validator";
import { CreateLocationInput } from "../../validators/location.validator";
import { organizationService } from "../organization.service";
import { locationService } from "../location.service";
import { Row, recordAudit } from "./common";

type Json = Record<string, unknown>;

async function rpc(fn: string, args: unknown[], placeholders: string): Promise<Json> {
  const r = await query<{ r: Json }>(`SELECT public.${fn}(${placeholders}) AS r;`, args);
  return r.rows[0].r;
}

async function assertOrg(id: string): Promise<void> {
  const r = await query("SELECT 1 FROM organizations WHERE id = $1;", [id]);
  if (!r.rows[0]) throw new NotFoundException("Organization not found");
}

export const orgService = {
  /** Extended create: the base organization (plan / owner invite via master_create_organization), extra locations, ordering switch. */
  async create(actor: Actor, body: CreateOrganizationInput) {
    if (body.ordering_open && body.status !== "Active" && body.status !== "Approved") {
      throw new BadRequestException("Ordering can only be opened for an Active organization", "ordering_requires_active");
    }
    const organization = await organizationService.createOrganization({
      business_name: body.business_name,
      domain: body.domain,
      email: body.email,
      phone_number: body.phone_number,
      status: body.status,
      plan_code: body.plan_code,
      owner_email: body.owner_email,
    });
    await recordAudit(actor, "master.organization_created", "organizations", organization.id, organization.id, {
      plan_code: body.plan_code ?? null,
      owner_invited: !!body.owner_email,
    });
    const warnings: string[] = [];
    const locations: unknown[] = [];
    for (const loc of body.locations ?? []) {
      try {
        locations.push(await locationService.createLocation(organization.id, loc as unknown as CreateLocationInput));
      } catch (e) {
        warnings.push(`Location '${(loc as { name: string }).name}' was not created: ${(e as Error).message}`);
      }
    }
    let ordering: Json | null = null;
    if (body.ordering_open) {
      try {
        ordering = await rpc("master_set_ordering", [organization.id, true, "Opened at organization creation", actor.id], "$1::uuid, $2::boolean, $3::text, $4::uuid");
      } catch (e) {
        warnings.push(`Ordering was not opened: ${(e as Error).message}`);
      }
    }
    return { organization, locations, ordering, warnings };
  },

  async setOrdering(actor: Actor, id: string, accepting: boolean, reason: string) {
    return rpc("master_set_ordering", [id, accepting, reason, actor.id], "$1::uuid, $2::boolean, $3::text, $4::uuid");
  },
  async suspend(actor: Actor, id: string, reason: string) {
    return rpc("master_suspend_organization", [id, reason, actor.id], "$1::uuid, $2::text, $3::uuid");
  },
  async reactivate(actor: Actor, id: string, reason: string) {
    return rpc("master_reactivate_organization", [id, reason, actor.id], "$1::uuid, $2::text, $3::uuid");
  },
  async archive(actor: Actor, id: string, reason: string) {
    return rpc("master_archive_organization", [id, reason, actor.id], "$1::uuid, $2::text, $3::uuid");
  },
  async restore(actor: Actor, id: string, reason: string) {
    return rpc("master_restore_organization", [id, reason, actor.id], "$1::uuid, $2::text, $3::uuid");
  },
  async changePlan(actor: Actor, id: string, planCode: string, reason: string) {
    return rpc("master_change_plan", [id, planCode, reason, actor.id], "$1::uuid, $2::text, $3::text, $4::uuid");
  },

  /** Entitlements as the platform sees them (service context: not tenant-scoped). */
  async entitlements(id: string) {
    await assertOrg(id);
    const r = await query<{ e: Json }>(`SELECT public.org_entitlements($1::uuid) AS e;`, [id]);
    const sub = await query<Row>(
      `SELECT s.id, s.status, s.billing_cadence, s.current_period_start, s.current_period_end, s.trial_end, s.cancel_at_period_end, p.plan_code, p.name AS plan_name, p.price_minor, p.currency_code
         FROM subscriptions s JOIN commercial_plans p ON p.id = s.plan_id WHERE s.organization_id = $1 AND s.status IN ('Trial','Active','Past Due') LIMIT 1;`,
      [id]
    );
    const usage = await query<Row>(
      `SELECT (SELECT count(*)::int FROM locations WHERE organization_id = $1 AND status = 'active') AS active_locations,
              (SELECT count(*)::int FROM org_users WHERE organization_id = $1 AND status = 'active') AS active_users;`,
      [id]
    );
    return { organization_id: id, entitlements: r.rows[0].e, subscription: sub.rows[0] ?? null, usage: usage.rows[0] };
  },

  /** Organization 360: one read model for the detail screen. */
  async view360(id: string) {
    const org = await query<Row>(
      `SELECT id, name, slug, legal_name, business_domain, control_status, status, status_reason, status_changed_at, contact_email, contact_phone,
              archived_at, archive_reason, default_locale, created_at, updated_at FROM organizations WHERE id = $1;`,
      [id]
    );
    if (!org.rows[0]) throw new NotFoundException("Organization not found");
    const [locs, ent, ordering, users, invites, orders, riders, settle, payouts, open, audit] = await Promise.all([
      query<Row>(`SELECT id, name, code, kind, status, area, timezone, currency_code FROM locations WHERE organization_id = $1 ORDER BY created_at LIMIT 50;`, [id]),
      this.entitlements(id),
      query<Row>(`SELECT accepting, back_at, updated_at FROM ol_merchant_channels WHERE organization_id = $1;`, [id]),
      query<Row>(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*)::int AS total FROM org_users WHERE organization_id = $1;`, [id]),
      query<Row>(`SELECT status, count(*)::int AS n FROM org_invitations WHERE organization_id = $1 GROUP BY status;`, [id]),
      query<Row>(
        `SELECT count(*)::int AS orders_30d, coalesce(sum(total_minor),0)::bigint AS gmv_30d_minor,
                (array_agg(currency_code))[1] AS currency_code
           FROM orders WHERE organization_id = $1 AND created_at > now() - interval '30 days';`,
        [id]
      ),
      query<Row>(`SELECT count(*)::int AS n FROM riders WHERE organization_id = $1;`, [id]),
      query<Row>(`SELECT id, period_start, period_end, status, net_minor, currency_code FROM settlements WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 5;`, [id]),
      query<Row>(`SELECT coalesce(sum(amount_minor) FILTER (WHERE status IN ('pending','approved')),0)::bigint AS open_minor, coalesce(sum(amount_minor) FILTER (WHERE status = 'paid'),0)::bigint AS paid_minor FROM payouts WHERE organization_id = $1;`, [id]),
      query<{ c: Json }>(`SELECT public.org_open_order_counts($1::uuid) AS c;`, [id]),
      query<Row>(`SELECT id, action, entity_type, actor_user_id, created_at FROM audit_logs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 10;`, [id]),
    ]);
    return {
      organization: org.rows[0],
      locations: locs.rows,
      subscription: ent.subscription,
      entitlements: ent.entitlements,
      usage: ent.usage,
      ordering: { accepting: ordering.rows[0]?.accepting ?? false, updated_at: ordering.rows[0]?.updated_at ?? null },
      users: users.rows[0],
      invitations: Object.fromEntries(invites.rows.map((r) => [r.status as string, r.n])),
      orders: { ...orders.rows[0], open: open.rows[0].c },
      riders: { linked: riders.rows[0].n },
      settlements: settle.rows,
      payouts: { ...payouts.rows[0], currency_code: orders.rows[0].currency_code ?? "INR" },
      recent_audit: audit.rows,
    };
  },
};
