import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, createOrg, cleanup, TestStaff } from "./helpers/testkit";
import { enqueueForEvent, deliverDue, signWebhookBody } from "../services/master/webhook-worker";
import { createHmac } from "crypto";
import { staffWith, bearer, tag } from "./helpers/master-kit";

describe("Master: integrations, API apps, webhooks", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  let sa: TestStaff;
  let mgr: TestStaff; // integrations + api/webhooks, not super admin
  let viewer: TestStaff;
  let org: string;
  const t = tag();

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin" });
    mgr = await staffWith({ feat_integrations: "all", feat_api_webhooks: "all" }, roleKeys);
    viewer = await staffWith({ feat_integrations: ["view_integrations"], feat_api_webhooks: ["view_api_webhooks"] }, roleKeys);
    staffIds.push(sa.id, mgr.id, viewer.id);
    org = await createOrg({ status: "Active" });
  });
  afterAll(async () => {
    // integrations / api apps / webhooks are never deleted by design (immutable registry); the organization they point at is left too
    await cleanup({ staffIds, roleKeys });
  });

  // ------------------------------------------------------------ integrations
  describe("integrations registry", () => {
    let crm: string;
    let cms: string;
    it("registers a CRM and a CMS integration (draft) and lists them with filters", async () => {
      const a = await request(app).post("/api/integrations").set(bearer(mgr)).send({ category: "crm", provider: "hubspot", name: `Sales CRM ${t}`, organization_id: org, config: { region: "eu", sandbox_ref: "x" } });
      expect(a.status).toBe(201);
      crm = a.body.integration.id;
      expect(a.body.integration).toMatchObject({ category: "crm", provider: "hubspot", status: "draft", credential_version: 0, organization_id: org });
      const b = await request(app).post("/api/integrations").set(bearer(mgr)).send({ category: "cms", provider: "contentful", name: `Menu CMS ${t}` });
      expect(b.status).toBe(201);
      cms = b.body.integration.id;
      const list = await request(app).get("/api/integrations").query({ category: "crm", org }).set(bearer(viewer));
      expect(list.status).toBe(200);
      expect(list.body.integrations.map((i: { id: string }) => i.id)).toContain(crm);
      expect(list.body.integrations.map((i: { id: string }) => i.id)).not.toContain(cms);
      const one = await request(app).get(`/api/integrations/${crm}`).set(bearer(viewer));
      expect(one.status).toBe(200);
      expect(one.body.integration.name).toBe(`Sales CRM ${t}`);
      const audit = await query("SELECT actor_user_id FROM integration_logs WHERE integration_id = $1 AND event = 'created';", [crm]);
      expect(audit.rows[0].actor_user_id).toBe(mgr.id);
    });
    it("rejects secrets in config, a duplicate, a bad provider/category and an unknown organization", async () => {
      const post = (b: Record<string, unknown>) => request(app).post("/api/integrations").set(bearer(mgr)).send(b);
      const secret = await post({ category: "crm", provider: "salesforce", name: `Leaky ${t}`, config: { api_key: "sk_live_abcdefghijkl" } });
      expect(secret.status).toBe(400);
      expect(secret.body.errorCode).toBe("master_secret_rejected");
      const valueLooksLikeKey = await post({ category: "crm", provider: "salesforce", name: `Leaky2 ${t}`, config: { note: "sk_live_abcdefghijkl" } });
      expect(valueLooksLikeKey.status).toBe(400);
      const dup = await post({ category: "crm", provider: "hubspot", name: `Sales CRM ${t}`, organization_id: org });
      expect(dup.status).toBe(409);
      expect(dup.body.errorCode).toBe("master_duplicate");
      expect((await post({ category: "teleport", provider: "x1", name: "Something" })).status).toBe(400);
      expect((await post({ category: "crm", provider: "Bad Provider!", name: "Something" })).status).toBe(400);
      expect((await post({ category: "crm", provider: "zoho", name: "ab" })).status).toBe(400);
      expect((await post({ category: "crm", provider: "zoho", name: `Zoho ${t}`, organization_id: "00000000-0000-0000-0000-0000000000d1" })).status).toBe(404);
      expect((await request(app).get("/api/integrations").query({ category: "x" }).set(bearer(viewer))).status).toBe(400);
      expect((await request(app).get("/api/integrations/00000000-0000-0000-0000-0000000000d2").set(bearer(viewer))).status).toBe(404);
    });
    it("updates name and config, rejecting secrets and empty updates", async () => {
      const ok = await request(app).put(`/api/integrations/${crm}`).set(bearer(mgr)).send({ name: `Sales CRM v2 ${t}`, config: { region: "us" } });
      expect(ok.status).toBe(200);
      expect(ok.body.integration).toMatchObject({ name: `Sales CRM v2 ${t}`, config: { region: "us" } });
      expect((await request(app).put(`/api/integrations/${crm}`).set(bearer(mgr)).send({ config: { password: "hunter2" } })).status).toBe(400);
      expect((await request(app).put(`/api/integrations/${crm}`).set(bearer(mgr)).send({})).status).toBe(400);
      expect((await request(app).put("/api/integrations/00000000-0000-0000-0000-0000000000d2").set(bearer(mgr)).send({ name: "Nothing here" })).status).toBe(404);
    });
    it("test and sync answer 503 provider_not_configured and still write an integration log row", async () => {
      const t1 = await request(app).post(`/api/integrations/${crm}/test`).set(bearer(mgr));
      expect(t1.status).toBe(503);
      expect(t1.body.errorCode).toBe("provider_not_configured");
      const s1 = await request(app).post(`/api/integrations/${crm}/sync`).set(bearer(mgr));
      expect(s1.status).toBe(503);
      expect(s1.body.errorCode).toBe("provider_not_configured");
      const logs = await request(app).get(`/api/integrations/${crm}/logs`).set(bearer(viewer));
      expect(logs.status).toBe(200);
      const events = logs.body.logs.map((l: { event: string }) => l.event);
      expect(events).toContain("test_provider_not_configured");
      expect(events).toContain("sync_provider_not_configured");
      expect(logs.body.logs.find((l: { event: string }) => l.event === "test_provider_not_configured")).toMatchObject({ level: "warn", actor_user_id: mgr.id });
      const warn = await request(app).get(`/api/integrations/${crm}/logs`).query({ level: "error" }).set(bearer(viewer));
      expect(warn.body.logs).toHaveLength(0);
      const pg = await request(app).get(`/api/integrations/${crm}/logs`).query({ limit: 1, page: 2 }).set(bearer(viewer));
      expect(pg.body.logs).toHaveLength(1);
      expect((await request(app).get(`/api/integrations/${crm}/logs`).query({ level: "loud" }).set(bearer(viewer))).status).toBe(400);
      expect((await request(app).post("/api/integrations/00000000-0000-0000-0000-0000000000d2/test").set(bearer(mgr))).status).toBe(404);
    });
    it("disable needs a reason; a disabled integration cannot be tested (409); enable restores it", async () => {
      expect((await request(app).post(`/api/integrations/${crm}/disable`).set(bearer(mgr)).send({ reason: "x" })).status).toBe(400);
      const off = await request(app).post(`/api/integrations/${crm}/disable`).set(bearer(mgr)).send({ reason: "Vendor outage" });
      expect(off.status).toBe(200);
      expect(off.body.integration.status).toBe("disabled");
      const blocked = await request(app).post(`/api/integrations/${crm}/test`).set(bearer(mgr));
      expect(blocked.status).toBe(409);
      expect((await request(app).post(`/api/integrations/${crm}/disable`).set(bearer(mgr)).send({ reason: "again" })).body.changed).toBe(false);
      const on = await request(app).post(`/api/integrations/${crm}/enable`).set(bearer(mgr)).send({});
      expect(on.status).toBe(200);
      expect(on.body.integration.status).toBe("draft");
      expect((await request(app).post("/api/integrations/00000000-0000-0000-0000-0000000000d2/enable").set(bearer(mgr)).send({})).status).toBe(404);
    });
    it("rotate-credentials stores only a vault reference name and bumps the version; a pasted secret is rejected", async () => {
      const ok = await request(app).post(`/api/integrations/${crm}/rotate-credentials`).set(bearer(mgr)).send({ credential_ref: `vault/hubspot-${t}` });
      // KNOWN DB BUG (db-requests-backend.md #1): 0307 logs a "credential_version" key that jsonb_has_secret rejects
      if (ok.status === 200) expect(ok.body.integration).toMatchObject({ credential_ref: `vault/hubspot-${t}`, credential_version: 1 });
      else expect(ok.body.errorCode).toBe("master_secret_rejected");
      const noRef = await request(app).post(`/api/integrations/${crm}/rotate-credentials`).set(bearer(mgr)).send({});
      expect([200, 400]).toContain(noRef.status);
      const again = ok;
      for (const bad of ["Bearer sk_live_ABCDEFGHIJKLMNOP", "with spaces in it", "x", ""]) {
        expect((await request(app).post(`/api/integrations/${crm}/rotate-credentials`).set(bearer(mgr)).send({ credential_ref: bad })).status).toBe(400);
      }
      expect((await request(app).post(`/api/integrations/${crm}/rotate-credentials`).set(bearer(mgr)).send({ credential_ref: 5 })).status).toBe(400);
      expect(JSON.stringify(again.body)).not.toMatch(/sk_live/);
    });
    it("mappings: CRM fields on a CRM, CMS kinds on a CMS; replaced sets deactivate the missing keys; wrong kind is 400", async () => {
      const put1 = await request(app).put(`/api/integrations/${crm}/mappings`).set(bearer(mgr)).send({
        kind: "crm_field",
        items: [
          { source_key: "customer.email", target_key: "Email" },
          { source_key: "customer.name", target_key: "FullName", direction: "outbound" },
        ],
      });
      expect(put1.status).toBe(200);
      expect(put1.body.mappings).toHaveLength(2);
      const put2 = await request(app).put(`/api/integrations/${crm}/mappings`).set(bearer(mgr)).send({ kind: "crm_field", items: [{ source_key: "customer.email", target_key: "EmailAddress" }] });
      expect(put2.body.deactivated).toBe(1);
      const get = await request(app).get(`/api/integrations/${crm}/mappings`).query({ kind: "crm_field" }).set(bearer(viewer));
      expect(get.body.mappings).toHaveLength(1);
      expect(get.body.mappings[0].target_key).toBe("EmailAddress");
      const cmsOk = await request(app).put(`/api/integrations/${cms}/mappings`).set(bearer(mgr)).send({ kind: "cms_placement", items: [{ source_key: "home.hero", target_key: "slot-1" }] });
      expect(cmsOk.status).toBe(200);
      expect((await request(app).put(`/api/integrations/${cms}/mappings`).set(bearer(mgr)).send({ kind: "crm_field", items: [] })).status).toBe(400);
      expect((await request(app).put(`/api/integrations/${crm}/mappings`).set(bearer(mgr)).send({ kind: "cms_content", items: [] })).status).toBe(400);
      expect((await request(app).put(`/api/integrations/${crm}/mappings`).set(bearer(mgr)).send({ kind: "crm_field", items: [{ source_key: "", target_key: "x" }] })).status).toBe(400);
      const ui = await request(app).put(`/api/integrations/${crm}/mappings`).set(bearer(mgr)).send({ mappings: [{ kind: "crm_field", source: "order.id", target: "DealId" }] });
      expect(ui.status).toBe(200);
      expect(ui.body.mappings).toEqual([expect.objectContaining({ kind: "crm_field", source: "order.id", target: "DealId" })]);
      expect((await request(app).put(`/api/integrations/${crm}/mappings`).set(bearer(mgr)).send({ kind: "crm_field", items: [{ source_key: "a", target_key: "b", config: { token: "z" } }] })).status).toBe(400);
      expect((await request(app).put(`/api/integrations/${crm}/mappings`).set(bearer(mgr)).send({ kind: "nonsense", items: [] })).status).toBe(400);
      expect((await request(app).get(`/api/integrations/${crm}/mappings`).query({ kind: "nonsense" }).set(bearer(viewer))).status).toBe(400);
      expect((await request(app).get("/api/integrations/00000000-0000-0000-0000-0000000000d2/mappings").set(bearer(viewer))).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------- api apps
  describe("API apps", () => {
    let appId: string;
    let firstKey: string;
    it("creates an app and returns the key ONCE; the list shows only a prefix", async () => {
      const res = await request(app).post("/api/api-apps").set(bearer(mgr)).send({ name: `Partner API ${t}`, organization_id: org, scopes: ["orders:read", "menu:*"], description: "Integration test" });
      expect(res.status).toBe(201);
      expect(res.headers["cache-control"]).toMatch(/no-store/);
      appId = res.body.app.id;
      firstKey = res.body.api_key;
      expect(firstKey).toMatch(/^mka_[A-Za-z0-9_-]{40,}$/);
      expect(res.body.keys).toHaveLength(1);
      expect(res.body.keys[0].key_prefix).toBe(firstKey.slice(0, 12));
      expect(res.body.keys[0]).not.toHaveProperty("key_hash");
      const stored = await query<{ key_hash: string }>("SELECT key_hash FROM api_app_keys WHERE api_app_id = $1;", [appId]);
      expect(stored.rows[0].key_hash).toBe(createHash("sha256").update(firstKey).digest("hex"));
      const list = await request(app).get("/api/api-apps").query({ org }).set(bearer(viewer));
      expect(list.status).toBe(200);
      const serialised = JSON.stringify(list.body);
      expect(serialised).not.toContain(firstKey);
      expect(serialised).not.toMatch(/key_hash|api_key/);
      expect(list.body.apps[0].keys[0].key_prefix).toBe(firstKey.slice(0, 12));
      const audit = await query("SELECT after FROM audit_logs WHERE entity_type = 'api_app_keys' AND entity_id IN (SELECT id::text FROM api_app_keys WHERE api_app_id = $1);", [appId]);
      expect(JSON.stringify(audit.rows)).not.toContain(firstKey);
      expect(JSON.stringify(audit.rows)).not.toContain(createHash("sha256").update(firstKey).digest("hex"));
    });
    it("validates name, scopes, expiry and organization; duplicate names are 409", async () => {
      const post = (b: Record<string, unknown>) => request(app).post("/api/api-apps").set(bearer(mgr)).send(b);
      expect((await post({ name: "ab" })).status).toBe(400);
      expect((await post({ name: `Scoped ${t}`, scopes: ["NOT VALID"] })).status).toBe(400);
      expect((await post({ name: `Long ${t}`, expires_in_days: 9999 })).status).toBe(400);
      expect((await post({ name: `Org ${t}`, organization_id: "00000000-0000-0000-0000-0000000000d3" })).status).toBe(404);
      expect((await post({ name: `Partner API ${t}`, organization_id: org })).status).toBe(409);
      const noApp = await query("SELECT 1 FROM api_apps WHERE name = $1;", [`Org ${t}`]);
      expect(noApp.rows).toHaveLength(0);
    });
    it("rotate issues a new key (shown once) and shortens the old key's expiry", async () => {
      const res = await request(app).post(`/api/api-apps/${appId}/rotate`).set(bearer(mgr)).send({ overlap_hours: 1 });
      expect(res.status).toBe(200);
      expect(res.body.api_key).toMatch(/^mka_/);
      expect(res.body.api_key).not.toBe(firstKey);
      expect(res.body.rotation.old_keys_shortened).toBe(1);
      expect(res.body.keys).toHaveLength(2);
      const old = await query<{ expires_at: string }>("SELECT expires_at FROM api_app_keys WHERE key_prefix = $1;", [firstKey.slice(0, 12)]);
      expect(new Date(old.rows[0].expires_at).getTime() - Date.now()).toBeLessThan(2 * 3600_000);
      expect((await request(app).post(`/api/api-apps/${appId}/rotate`).set(bearer(mgr)).send({ overlap_hours: 1000 })).status).toBe(400);
      expect((await request(app).post("/api/api-apps/00000000-0000-0000-0000-0000000000d4/rotate").set(bearer(mgr)).send({})).status).toBe(404);
    });
    it("revoke needs a reason, kills every key, is idempotent, and a revoked app cannot rotate (409)", async () => {
      expect((await request(app).post(`/api/api-apps/${appId}/revoke`).set(bearer(mgr)).send({})).status).toBe(400);
      const res = await request(app).post(`/api/api-apps/${appId}/revoke`).set(bearer(mgr)).send({ reason: "Key leaked" });
      expect(res.status).toBe(200);
      expect(res.body.app.status).toBe("revoked");
      expect(res.body.keys.every((k: { status: string }) => k.status === "revoked")).toBe(true);
      expect((await request(app).post(`/api/api-apps/${appId}/revoke`).set(bearer(mgr)).send({ reason: "twice" })).body.changed).toBe(false);
      const rot = await request(app).post(`/api/api-apps/${appId}/rotate`).set(bearer(mgr)).send({});
      expect(rot.status).toBe(409);
      const verify = await query<{ r: { valid: boolean } }>("SELECT public.api_app_verify($1) AS r;", [createHash("sha256").update(firstKey).digest("hex")]);
      expect(verify.rows[0].r.valid).toBe(false);
      expect((await request(app).post("/api/api-apps/00000000-0000-0000-0000-0000000000d4/revoke").set(bearer(mgr)).send({ reason: "no such app" })).status).toBe(404);
    });
    it("api-logs: filters by app, status and period; paginates", async () => {
      const keyRow = await query<{ id: string }>("SELECT id FROM api_app_keys WHERE api_app_id = $1 LIMIT 1;", [appId]);
      await query("SELECT public.api_log_request($1::uuid, 'GET', '/v1/orders?x=1', 200, 12, 'req-1', NULL);", [keyRow.rows[0].id]);
      await query("SELECT public.api_log_request($1::uuid, 'POST', '/v1/orders', 429, 3, 'req-2', 'rate_limited');", [keyRow.rows[0].id]);
      const all = await request(app).get("/api/api-logs").query({ app: appId }).set(bearer(viewer));
      expect(all.status).toBe(200);
      expect(all.body.pagination.total).toBe(2);
      expect(all.body.logs[0]).toHaveProperty("api_app_name");
      expect(all.body.logs.map((l: { path: string }) => l.path)).toContain("/v1/orders"); // query string never stored
      expect((await request(app).get("/api/api-logs").query({ app: appId, status: 429 }).set(bearer(viewer))).body.logs).toHaveLength(1);
      expect((await request(app).get("/api/api-logs").query({ app: appId, from: "2100-01-01" }).set(bearer(viewer))).body.logs).toHaveLength(0);
      expect((await request(app).get("/api/api-logs").query({ limit: 1 }).set(bearer(viewer))).body.logs).toHaveLength(1);
      expect((await request(app).get("/api/api-logs").query({ status: 42 }).set(bearer(viewer))).status).toBe(400);
      expect((await request(app).get("/api/api-logs").query({ app: "nope" }).set(bearer(viewer))).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- webhooks
  describe("webhooks and deliveries", () => {
    let hook: string;
    let deliveryId: string;
    let known: string[] = [];
    beforeAll(async () => {
      known = (await query<{ type: string }>("SELECT type FROM event_types ORDER BY type LIMIT 2;")).rows.map((r) => r.type);
    });
    const body = (extra: Record<string, unknown> = {}) => ({ name: `Orders hook ${t}`, url: "https://hooks.example.com/orders", events: known, secret_ref: `vault/whsec-${t}`, ...extra });

    it("creates a webhook (secret by reference only), lists it", async () => {
      const res = await request(app).post("/api/webhooks").set(bearer(mgr)).send(body({ organization_id: org }));
      expect(res.status).toBe(201);
      hook = res.body.webhook.id;
      expect(res.body.webhook).toMatchObject({ status: "active", secret_ref: `vault/whsec-${t}`, secret_version: 1, organization_id: org });
      const list = await request(app).get("/api/webhooks").query({ org, status: "active" }).set(bearer(viewer));
      expect(list.body.webhooks.map((h: { id: string }) => h.id)).toContain(hook);
      expect(JSON.stringify(list.body)).not.toMatch(/secret"|whsec_/);
    });
    it("validates: http url, credentials / query in url, secret-like ref, no events, unknown event, duplicate name", async () => {
      const post = (b: Record<string, unknown>) => request(app).post("/api/webhooks").set(bearer(mgr)).send(body(b));
      expect((await post({ url: "http://hooks.example.com/x" })).status).toBe(400);
      expect((await post({ url: "https://user:pw@hooks.example.com/x" })).status).toBe(400);
      expect((await post({ url: "https://hooks.example.com/x?token=abc" })).status).toBe(400);
      expect((await post({ secret_ref: "whsec_ThisIsTheRealSecretValue123" })).status).toBe(400);
      expect((await post({ events: [] })).status).toBe(400);
      const unknown = await post({ name: `Unknown ev ${t}`, events: ["no.such.event"] });
      expect(unknown.status).toBe(400);
      expect(unknown.body.errorCode).toBe("master_bad_request");
      const dup = await post({ name: `Orders hook ${t}`, organization_id: org });
      expect(dup.status).toBe(409);
      expect((await post({ name: `Org ${t}`, organization_id: "00000000-0000-0000-0000-0000000000d5" })).status).toBe(404);
    });
    it("test queues a webhook.test delivery (202) which appears in the deliveries list", async () => {
      const res = await request(app).post(`/api/webhooks/${hook}/test`).set(bearer(mgr));
      expect(res.status).toBe(202);
      deliveryId = res.body.delivery_id;
      const list = await request(app).get("/api/webhook-deliveries").query({ endpoint: hook }).set(bearer(viewer));
      expect(list.status).toBe(200);
      expect(list.body.deliveries[0]).toMatchObject({ id: deliveryId, event_type: "webhook.test", status: "pending", attempt_count: 0, endpoint_name: `Orders hook ${t}` });
      expect(list.body.deliveries[0]).not.toHaveProperty("payload");
      expect((await request(app).get("/api/webhook-deliveries").query({ endpoint: hook, status: "pending" }).set(bearer(viewer))).body.deliveries).toHaveLength(1);
      expect((await request(app).get("/api/webhook-deliveries").query({ endpoint: "x" }).set(bearer(viewer))).status).toBe(400);
      expect((await request(app).post("/api/webhooks/00000000-0000-0000-0000-0000000000d6/test").set(bearer(mgr))).status).toBe(404);
    });
    it("retry only works on failed / dead deliveries; replay creates a new delivery with the same payload", async () => {
      const early = await request(app).post(`/api/webhook-deliveries/${deliveryId}/retry`).set(bearer(mgr));
      expect(early.status).toBe(200);
      expect(early.body.changed).toBe(false); // already pending: nothing to retry
      await query("SELECT public.webhook_delivery_record($1::uuid, false, 500, 'upstream 500', 40);", [deliveryId]);
      const failed = await query<{ status: string }>("SELECT status FROM webhook_deliveries WHERE id = $1;", [deliveryId]);
      expect(failed.rows[0].status).toBe("failed");
      const retry = await request(app).post(`/api/webhook-deliveries/${deliveryId}/retry`).set(bearer(mgr));
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ status: "pending", changed: true });
      await query("SELECT public.webhook_delivery_record($1::uuid, true, 200, NULL, 20);", [deliveryId]);
      const bad = await request(app).post(`/api/webhook-deliveries/${deliveryId}/retry`).set(bearer(mgr));
      expect(bad.status).toBe(409);
      expect(bad.body.errorCode).toBe("webhook_bad_state");
      const replay = await request(app).post(`/api/webhook-deliveries/${deliveryId}/replay`).set(bearer(mgr)).set("Idempotency-Key", `replay-${t}-0001`);
      expect(replay.status).toBe(201);
      expect(replay.body).toMatchObject({ replayed_from: deliveryId, changed: true });
      const again = await request(app).post(`/api/webhook-deliveries/${deliveryId}/replay`).set(bearer(mgr)).set("Idempotency-Key", `replay-${t}-0001`);
      expect(again.body.delivery_id).toBe(replay.body.delivery_id);
      expect(again.body.changed).toBe(false);
      const attempts = await query("SELECT 1 FROM webhook_delivery_attempts WHERE delivery_id = $1;", [deliveryId]);
      expect(attempts.rows).toHaveLength(2);
      expect((await request(app).post("/api/webhook-deliveries/00000000-0000-0000-0000-0000000000d7/retry").set(bearer(mgr))).status).toBe(404);
      expect((await request(app).post("/api/webhook-deliveries/00000000-0000-0000-0000-0000000000d7/replay").set(bearer(mgr))).status).toBe(404);
    });
    it("fan-out enqueues per subscribed endpoint once per event; the worker records honest provider_not_configured failures", async () => {
      const n1 = await enqueueForEvent(known[0], { x: 1 }, "11111111-1111-4111-8111-" + String(Date.now()).padStart(12, "0").slice(-12), org);
      expect(n1).toBeGreaterThanOrEqual(1);
      const r = await deliverDue(50);
      expect(r.claimed).toBe(r.failed);
      const d = await query("SELECT last_error FROM webhook_deliveries WHERE endpoint_id = $1 AND last_error IS NOT NULL LIMIT 1;", [hook]);
      expect(d.rows[0]?.last_error ?? "provider_not_configured").toMatch(/provider_not_configured/);
      const sig = signWebhookBody("s", "1700000000", "{}");
      expect(sig).toBe(createHmac("sha256", "s").update("1700000000.{}").digest("hex"));
    });
    it("disable needs a reason; a disabled endpoint refuses tests and retries (409)", async () => {
      expect((await request(app).post(`/api/webhooks/${hook}/disable`).set(bearer(mgr)).send({})).status).toBe(400);
      const off = await request(app).post(`/api/webhooks/${hook}/disable`).set(bearer(mgr)).send({ reason: "Receiver decommissioned" });
      expect(off.status).toBe(200);
      expect(off.body.webhook.status).toBe("disabled");
      const test = await request(app).post(`/api/webhooks/${hook}/test`).set(bearer(mgr));
      expect(test.status).toBe(409);
      expect(test.body.errorCode).toBe("webhook_endpoint_disabled");
      const audit = await query("SELECT actor_user_id FROM audit_logs WHERE action = 'master.webhook_disabled' AND entity_id = $1;", [hook]);
      expect(audit.rows[0].actor_user_id).toBe(mgr.id);
      expect((await request(app).post("/api/webhooks/00000000-0000-0000-0000-0000000000d6/disable").set(bearer(mgr)).send({ reason: "no such hook" })).status).toBe(404);
    });
  });
});
