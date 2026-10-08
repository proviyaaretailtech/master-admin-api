import { createHash, randomBytes } from "crypto";
import { query, txAs } from "../../config/database.config";
import { Actor } from "../../utils/authz";
import { NotFoundException } from "../../utils/app-error";
import { pageMeta } from "../../validators/master.validator";
import { Row, Where, scrub } from "./common";

type Json = Record<string, unknown>;
const days = (n?: number) => (n ? new Date(Date.now() + n * 86400_000).toISOString() : null);

/** A new API key: shown once to the operator, only its SHA-256 and an 12-char display prefix are ever stored. */
function newKey(): { key: string; hash: string; prefix: string } {
  const key = `mka_${randomBytes(32).toString("base64url")}`;
  return { key, hash: createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 12) };
}

const KEY_COLS = `id, api_app_id, key_prefix, status, expires_at, revoked_at, created_at, last_used_at`;

async function loadApp(id: string): Promise<Row> {
  const r = await query<Row>(
    `SELECT id, organization_id, name, description, status, scopes, revoked_at, revoked_reason, created_at, updated_at, last_used_at FROM api_apps WHERE id = $1;`,
    [id]
  );
  if (!r.rows[0]) throw new NotFoundException("API app not found");
  return r.rows[0];
}
async function keysOf(appId: string): Promise<Row[]> {
  return (await query<Row>(`SELECT ${KEY_COLS} FROM api_app_keys WHERE api_app_id = $1 ORDER BY created_at DESC;`, [appId])).rows;
}

export const platformService = {
  // --------------------------------------------------------------- api apps
  async listApps(f: { status?: string; org?: string; page: number; limit: number }) {
    const w = new Where().add("status = $?", f.status).add("organization_id = $?", f.org);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM api_apps ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT id, organization_id, name, description, status, scopes, revoked_at, created_at, last_used_at,
              (SELECT coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'key_prefix', k.key_prefix, 'status', k.status, 'expires_at', k.expires_at, 'last_used_at', k.last_used_at) ORDER BY k.created_at DESC), '[]'::jsonb)
                 FROM api_app_keys k WHERE k.api_app_id = api_apps.id) AS keys
         FROM api_apps ${w.sql} ORDER BY created_at DESC, id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    return { apps: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  /** Creates the app and its first key in ONE transaction. The plaintext key is in the returned object once and nowhere else. */
  async createApp(actor: Actor, b: { name: string; description?: string; organization_id?: string | null; scopes: string[]; expires_in_days?: number }) {
    const k = newKey();
    const appId = await txAs(null, async (c) => {
      const a = await c.query<{ r: Json }>(`SELECT public.master_api_app_create($1::text, $2::uuid, $3::text[], $4::text, $5::uuid) AS r;`, [
        b.name,
        b.organization_id ?? null,
        b.scopes,
        b.description ?? null,
        actor.id,
      ]);
      const id = a.rows[0].r.api_app_id as string;
      await c.query(`SELECT public.master_api_app_issue_key($1::uuid, $2::text, $3::text, $4::timestamptz, $5::uuid);`, [id, k.hash, k.prefix, days(b.expires_in_days), actor.id]);
      return id;
    });
    return { app: await loadApp(appId), keys: await keysOf(appId), api_key: k.key, api_key_notice: "Copy this key now. It is shown once and cannot be retrieved again." };
  },

  async rotateApp(actor: Actor, id: string, b: { overlap_hours: number; expires_in_days?: number }) {
    await loadApp(id);
    const k = newKey();
    const r = await query<{ r: Json }>(`SELECT public.master_api_app_rotate($1::uuid, $2::text, $3::text, $4::int, $5::timestamptz, $6::uuid) AS r;`, [
      id,
      k.hash,
      k.prefix,
      b.overlap_hours,
      days(b.expires_in_days),
      actor.id,
    ]);
    return { rotation: r.rows[0].r, app: await loadApp(id), keys: await keysOf(id), api_key: k.key, api_key_notice: "Copy this key now. It is shown once and cannot be retrieved again." };
  },

  async revokeApp(actor: Actor, id: string, reason: string) {
    await loadApp(id);
    const r = await query<{ r: Json }>(`SELECT public.master_api_app_revoke($1::uuid, $2::text, $3::uuid) AS r;`, [id, reason, actor.id]);
    return { ...r.rows[0].r, app: await loadApp(id), keys: await keysOf(id) };
  },

  async apiLogs(f: { app?: string; status?: number; from?: string; to?: string; page: number; limit: number }) {
    const w = new Where().add("l.api_app_id = $?", f.app).add("l.status_code = $?", f.status).add("l.created_at >= $?::timestamptz", f.from).add("l.created_at < $?::timestamptz", f.to);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM api_request_logs l ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT l.id, l.api_app_id, a.name AS api_app_name, l.key_id, l.organization_id, l.method, l.path, l.status_code, l.duration_ms, l.request_id, l.error_code, l.created_at
         FROM api_request_logs l LEFT JOIN api_apps a ON a.id = l.api_app_id ${w.sql} ORDER BY l.id DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    return { logs: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  // --------------------------------------------------------------- webhooks
  async listWebhooks(f: { status?: string; org?: string; page: number; limit: number }) {
    const w = new Where().add("e.status = $?", f.status).add("e.organization_id = $?", f.org);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM webhook_endpoints e ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT e.id, e.organization_id, e.name, e.url, e.events, e.secret_ref, e.secret_version, e.secret_rotated_at, e.status, e.status_reason,
              e.consecutive_failures, e.last_delivery_at, e.last_status, e.created_at
         FROM webhook_endpoints e ${w.sql} ORDER BY e.created_at DESC, e.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    return { webhooks: r.rows, pagination: pageMeta(total, f.page, f.limit) };
  },

  async createWebhook(actor: Actor, b: { name: string; url: string; events: string[]; secret_ref: string; organization_id?: string | null }) {
    const r = await query<{ r: Json }>(`SELECT public.master_webhook_create($1::text, $2::text, $3::text[], $4::text, $5::uuid, $6::uuid) AS r;`, [
      b.name,
      b.url,
      b.events,
      b.secret_ref,
      b.organization_id ?? null,
      actor.id,
    ]);
    return this.getWebhook(r.rows[0].r.webhook_id as string);
  },

  async getWebhook(id: string): Promise<Row> {
    const r = await query<Row>(
      `SELECT id, organization_id, name, url, events, secret_ref, secret_version, secret_rotated_at, status, status_reason, consecutive_failures, last_delivery_at, last_status, created_at
         FROM webhook_endpoints WHERE id = $1;`,
      [id]
    );
    if (!r.rows[0]) throw new NotFoundException("Webhook not found");
    return r.rows[0];
  },

  /** Queues a webhook.test delivery; the delivery worker (not part of this build) performs the HTTP call. */
  async testWebhook(actor: Actor, id: string) {
    await this.getWebhook(id);
    const r = await query<{ r: Json }>(`SELECT public.master_webhook_test($1::uuid, $2::uuid) AS r;`, [id, actor.id]);
    return r.rows[0].r;
  },

  async disableWebhook(actor: Actor, id: string, reason: string) {
    await this.getWebhook(id);
    const r = await query<{ r: Json }>(`SELECT public.master_webhook_set_status($1::uuid, false, $2::text, $3::uuid) AS r;`, [id, reason, actor.id]);
    return { ...r.rows[0].r, webhook: await this.getWebhook(id) };
  },

  async deliveries(f: { endpoint?: string; status?: string; page: number; limit: number }) {
    const w = new Where().add("d.endpoint_id = $?", f.endpoint).add("d.status = $?", f.status);
    const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM webhook_deliveries d ${w.sql};`, w.values)).rows[0].n;
    const r = await query<Row>(
      `SELECT d.id, d.endpoint_id, e.name AS endpoint_name, d.organization_id, d.event_id, d.event_type, d.status, d.attempt_count, d.max_attempts, d.next_attempt_at,
              d.last_attempt_at, d.last_http_status, d.last_error, d.response_ms, d.delivered_at, d.replayed_from, d.created_at
         FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id ${w.sql} ORDER BY d.created_at DESC, d.id LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit};`,
      w.values
    );
    return { deliveries: r.rows.map((x) => scrub(x)), pagination: pageMeta(total, f.page, f.limit) };
  },

  async retryDelivery(actor: Actor, id: string) {
    const x = await query("SELECT 1 FROM webhook_deliveries WHERE id = $1;", [id]);
    if (!x.rows[0]) throw new NotFoundException("Delivery not found");
    const r = await query<{ r: Json }>(`SELECT public.master_webhook_delivery_retry($1::uuid, $2::uuid) AS r;`, [id, actor.id]);
    return r.rows[0].r;
  },

  async replayDelivery(actor: Actor, id: string, key?: string) {
    const x = await query("SELECT 1 FROM webhook_deliveries WHERE id = $1;", [id]);
    if (!x.rows[0]) throw new NotFoundException("Delivery not found");
    const r = await query<{ r: Json }>(`SELECT public.master_webhook_delivery_replay($1::uuid, $2::text, $3::uuid) AS r;`, [id, key ?? null, actor.id]);
    return r.rows[0].r;
  },
};
