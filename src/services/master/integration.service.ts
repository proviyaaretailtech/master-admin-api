import { query } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { NotFoundException, ProviderNotConfiguredException } from "../../utils/app-error";
import { pageMeta } from "../../validators/master.validator";
import { Row, Where, scrub } from "./common";

type Json = Record<string, unknown>;

const COLS = `c.id, c.organization_id, c.category, c.provider, c.name, c.status, c.status_reason, c.config, c.credential_ref, c.credential_version,
  c.credentials_rotated_at, c.last_tested_at, c.last_test_ok, c.last_synced_at, c.last_error, c.created_at, c.updated_at`;

async function load(id: string): Promise<Row> {
  const r = await query<Row>(`SELECT ${COLS} FROM integration_connections c WHERE c.id = $1;`, [id]);
  if (!r.rows[0]) throw new NotFoundException("Integration not found");
  return r.rows[0];
}

export const integrationService = {
  async list(f: { category?: string; status?: string; org?: string; page: number; limit: number }) {
    const w = new Where().add("c.category = $?", f.category).add("c.status = $?", f.status).add("c.organization_id = $?", f.org);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM integration_connections c ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT ${COLS} FROM integration_connections c ${w.sql} ORDER BY c.created_at DESC, c.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    return { integrations: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async get(id: string) {
    const c = await load(id);
    const m = await query<Row>(`SELECT kind, count(*) FILTER (WHERE active)::int AS active FROM integration_mappings WHERE integration_id = $1 GROUP BY kind;`, [id]);
    return { integration: c, mappings_summary: m.rows };
  },

  async create(actor: Actor, b: { category: string; provider: string; name: string; organization_id?: string | null; config?: Json }) {
    const r = await query<{ r: Json }>(`SELECT public.master_integration_create($1::text, $2::text, $3::text, $4::uuid, $5::jsonb, $6::uuid) AS r;`, [
      b.category,
      b.provider,
      b.name,
      b.organization_id ?? null,
      JSON.stringify(b.config ?? {}),
      actor.id,
    ]);
    return load(r.rows[0].r.integration_id as string);
  },

  async update(actor: Actor, id: string, b: { name?: string; config?: Json }) {
    await load(id);
    await query(`SELECT public.master_integration_update($1::uuid, $2::text, $3::jsonb, $4::uuid);`, [id, b.name ?? null, b.config ? JSON.stringify(b.config) : null, actor.id]);
    return load(id);
  },

  /** Test / sync need a real provider client, which does not exist yet: the attempt is logged and the answer is 503 provider_not_configured. */
  async run(actor: Actor, id: string, kind: "test" | "sync"): Promise<never> {
    await load(id);
    await query(`SELECT public.master_integration_record_run($1::uuid, $2::text, 'provider_not_configured', $3::text, $4::uuid);`, [
      id,
      kind,
      `${kind} not run: no provider client is configured in this environment`,
      actor.id,
    ]);
    throw new ProviderNotConfiguredException(`The ${kind} could not run: no provider is configured for this integration`);
  },

  async setEnabled(actor: Actor, id: string, enabled: boolean, reason?: string) {
    await load(id);
    const r = await query<{ r: Json }>(`SELECT public.master_integration_set_enabled($1::uuid, $2::boolean, $3::text, $4::uuid) AS r;`, [id, enabled, reason ?? null, actor.id]);
    return { ...r.rows[0].r, integration: await load(id) };
  },

  async rotate(actor: Actor, id: string, credentialRef?: string) {
    const cur = await load(id);
    // no ref supplied: the next vault name is derived (the secret itself is written to the vault outside this API)
    credentialRef ??= `integration/${String(cur.provider)}-${id.slice(0, 8)}-v${Number(cur.credential_version) + 1}`;
    await query(`SELECT public.master_integration_rotate_credentials($1::uuid, $2::text, $3::uuid);`, [id, credentialRef, actor.id]);
    return load(id);
  },

  async logs(id: string, f: { level?: string; page: number; limit: number }) {
    await load(id);
    const w = new Where().add("integration_id = $?", id).add("level = $?", f.level);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM integration_logs ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT id, level, event, message, meta, actor_user_id, created_at FROM integration_logs ${w.sql} ORDER BY id DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    return { logs: r.rows.map((x) => scrub(x)), pagination: pageMeta(total, f.page, f.limit) };
  },

  async mappings(id: string, kind?: string) {
    await load(id);
    const w = new Where().add("integration_id = $?", id).add("kind = $?", kind);
    w.raw("active");
    const r = await query<Row>(`SELECT id, kind, source_key, target_key, direction, config, position, updated_at FROM integration_mappings ${w.sql} ORDER BY kind, position, id;`, w.values);
    return { mappings: r.rows };
  },

  /** UI form: every kind of the integration in one call (kinds not present are left alone). */
  async setAllMappings(actor: Actor, id: string, list: Array<{ kind: string; source: string; target: string; direction?: string }>) {
    const c = await load(id);
    const kinds = c.category === "crm" ? ["crm_field"] : ["cms_content", "cms_placement"];
    for (const k of kinds) {
      const items = list.filter((m) => m.kind === k).map((m) => ({ source_key: m.source, target_key: m.target, direction: m.direction }));
      await this.setMappings(actor, id, k, items);
    }
    const r = await this.mappings(id);
    return { mappings: r.mappings.map((m) => ({ id: m.id, kind: m.kind, source: m.source_key, target: m.target_key })) };
  },

  async setMappings(actor: Actor, id: string, kind: string, items: unknown[]) {
    await load(id);
    const r = await query<{ r: Json }>(`SELECT public.master_integration_set_mappings($1::uuid, $2::text, $3::jsonb, $4::uuid) AS r;`, [id, kind, JSON.stringify(items), actor.id]);
    return { ...r.rows[0].r, ...(await this.mappings(id, kind)) };
  },
};
