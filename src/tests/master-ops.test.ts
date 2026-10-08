import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import { AddressInfo } from "net";
import { createHash, createHmac } from "crypto";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { dispatchConfig, signingString, sign } from "../services/master/dispatch-client";
import { createStaff, createOrg, cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, seedOrder, seedJob, seedRider, wipeOrgData, tag } from "./helpers/master-kit";

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe("Master: orders, dispatch proxy, audit logs", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  const orgIds: string[] = [];
  const riderIds: string[] = [];
  let sa: TestStaff;
  let ops: TestStaff;
  let org: string;
  let server: http.Server;
  let seen: Seen[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: { id: "x", status: "created" } };
  const SERVICE_TOKEN = "svc-token-for-tests";
  const SIGNING_SECRET = "signing-secret-for-tests";
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin" });
    ops = await staffWith({ feat_orders: "all", feat_dispatch: "all", feat_audit_compliance: "all" }, roleKeys);
    staffIds.push(sa.id, ops.id);
    org = await createOrg({ status: "Active" });
    orgIds.push(org);
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    for (const k of ["DISPATCH_API_URL", "DISPATCH_SERVICE_TOKEN", "DISPATCH_SIGNING_SECRET"]) saved[k] = process.env[k];
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise((r) => server.close(r));
    await wipeOrgData(orgIds);
    await query("DELETE FROM delivery_exceptions WHERE job_id IN (SELECT id FROM delivery_jobs WHERE organization_id = ANY($1::uuid[]));", [orgIds]).catch(() => undefined);
    await query("DELETE FROM riders WHERE id = ANY($1::uuid[]);", [riderIds]).catch(() => undefined);
    await cleanup({ orgIds, staffIds, roleKeys });
  });
  const configure = () => {
    process.env.DISPATCH_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.DISPATCH_SERVICE_TOKEN = SERVICE_TOKEN;
    process.env.DISPATCH_SIGNING_SECRET = SIGNING_SECRET;
  };
  beforeEach(() => {
    seen = [];
    reply = { status: 200, body: { id: "x", status: "created" } };
  });

  // ------------------------------------------------------------------ orders
  describe("GET /orders", () => {
    let o1: string;
    beforeAll(async () => {
      o1 = await seedOrder(org, { status: "new", total: 199, channel: "dine_in" });
      await seedOrder(org, { status: "paid", total: 300, channel: "delivery" });
      await query("UPDATE orders SET customer_name = 'Priya Sharma', customer_phone = '+919812345678' WHERE id = $1;", [o1]);
    });
    it("filters by org, status, channel, search, date and paginates; money is minor units + currency; phone masked", async () => {
      const all = await request(app).get("/api/orders").query({ org }).set(bearer(ops));
      expect(all.status).toBe(200);
      expect(all.body.pagination.total).toBe(2);
      expect(all.body.orders.find((o: { id: string }) => o.id === o1)).toMatchObject({ total_minor: 19900, currency_code: "INR", customer_phone: "*********5678" });
      expect((await request(app).get("/api/orders").query({ org, status: "paid" }).set(bearer(ops))).body.orders).toHaveLength(1);
      expect((await request(app).get("/api/orders").query({ org, channel: "dine_in" }).set(bearer(ops))).body.orders).toHaveLength(1);
      expect((await request(app).get("/api/orders").query({ org, q: "priya" }).set(bearer(ops))).body.orders).toHaveLength(1);
      expect((await request(app).get("/api/orders").query({ org, from: "2100-01-01" }).set(bearer(ops))).body.orders).toHaveLength(0);
      const p = await request(app).get("/api/orders").query({ org, limit: 1, page: 2 }).set(bearer(ops));
      expect(p.body.orders).toHaveLength(1);
      expect(p.body.pagination.totalPages).toBe(2);
    });
    it("rejects a bad date, bad org id and page size (400)", async () => {
      expect((await request(app).get("/api/orders").query({ from: "yesterday-ish" }).set(bearer(ops))).status).toBe(400);
      expect((await request(app).get("/api/orders").query({ org: "nope" }).set(bearer(ops))).status).toBe(400);
      expect((await request(app).get("/api/orders").query({ limit: 101 }).set(bearer(ops))).status).toBe(400);
    });
  });

  describe("GET /orders/:id (Order 360)", () => {
    it("returns the trace with a merged timeline and no delivery-code hash", async () => {
      // order_events are append-only, so this organization (and its order) is deliberately left behind; the test database is disposable
      const keep = await createOrg({ status: "Active" });
      const id = await seedOrder(keep, { status: "new" });
      await query("INSERT INTO order_events (organization_id, order_id, kind, message) VALUES ($1, $2, 'created', 'Order created');", [keep, id]);
      const { jobId, olOrderId } = await seedJob(keep, { status: "created" });
      await query("UPDATE delivery_jobs SET pos_order_id = $1 WHERE id = $2;", [id, jobId]).catch(() => undefined);
      await query("UPDATE ol_orders SET pos_order_id = $1 WHERE id = $2;", [id, olOrderId]);
      const res = await request(app).get(`/api/orders/${id}`).set(bearer(ops));
      expect(res.status).toBe(200);
      expect(res.body.order.id).toBe(id);
      expect(Array.isArray(res.body.timeline)).toBe(true);
      expect(res.body.timeline.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toMatch(/otp_hash|customer_hash/);
    });
    it("404s an unknown order and 400s a malformed id", async () => {
      expect((await request(app).get("/api/orders/00000000-0000-0000-0000-0000000000b1").set(bearer(ops))).status).toBe(404);
      expect((await request(app).get("/api/orders/zzz").set(bearer(ops))).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- dispatch
  describe("GET /dispatch/jobs", () => {
    it("lists jobs with filters, no customer contact or code fields", async () => {
      const org = await createOrg({ status: "Active" });
      orgIds.push(org);
      const a = await seedJob(org, { status: "assigned" });
      await seedJob(org, { status: "delivered" });
      const res = await request(app).get("/api/dispatch/jobs").query({ org, status: "assigned" }).set(bearer(ops));
      expect(res.status).toBe(200);
      expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual([a.jobId]);
      expect(JSON.stringify(res.body)).not.toMatch(/otp_hash|customer_phone|customer_first_name|drop_address/);
      expect((await request(app).get("/api/dispatch/jobs").query({ org }).set(bearer(ops))).body.pagination.total).toBe(2);
      expect((await request(app).get("/api/dispatch/jobs").query({ status: "teleporting" }).set(bearer(ops))).status).toBe(400);
    });
    it("returns one job with assignments, exceptions and timeline; 404 / 400 otherwise", async () => {
      const rider = await seedRider({ status: "approved" });
      riderIds.push(rider);
      const j = await seedJob(org, { status: "assigned", rider });
      const res = await request(app).get(`/api/dispatch/jobs/${j.jobId}`).set(bearer(ops));
      expect(res.status).toBe(200);
      expect(res.body.job).toMatchObject({ id: j.jobId, status: "assigned", rider_id: rider, currency_code: "INR" });
      expect(res.body).toHaveProperty("assignments");
      expect(res.body).toHaveProperty("exceptions");
      expect((await request(app).get("/api/dispatch/jobs/00000000-0000-0000-0000-0000000000b2").set(bearer(ops))).status).toBe(404);
      expect((await request(app).get("/api/dispatch/jobs/xyz").set(bearer(ops))).status).toBe(400);
    });
  });

  describe("dispatch proxy: signing", () => {
    it("signs METHOD, path?query, timestamp and sha256(body) exactly as RIDER_DISPATCH_API.md section 2", () => {
      const body = '{"reason":"x"}';
      const expectedString = `POST\n/api/dispatch/jobs/abc/reassign\n1700000000\n${createHash("sha256").update(body).digest("hex")}`;
      expect(signingString("post", "/api/dispatch/jobs/abc/reassign", "1700000000", body)).toBe(expectedString);
      expect(sign("s3cret", "POST", "/api/dispatch/jobs/abc/reassign", "1700000000", body)).toBe(createHmac("sha256", "s3cret").update(expectedString).digest("hex"));
      // an empty body (GET) still hashes the empty string
      expect(signingString("GET", "/api/dispatch/events?after=0", "1", "")).toContain(createHash("sha256").update("").digest("hex"));
    });
    it("is configured only when URL, token and secret are all set", () => {
      expect(dispatchConfig({ DISPATCH_API_URL: "http://x" } as NodeJS.ProcessEnv)).toBeNull();
      expect(dispatchConfig({ DISPATCH_API_URL: "http://x/", DISPATCH_SERVICE_TOKEN: "t", DISPATCH_SIGNING_SECRET: "s" } as NodeJS.ProcessEnv)).toEqual({ baseUrl: "http://x", token: "t", secret: "s" });
    });
  });

  describe("POST /dispatch/jobs/:id/reassign|cancel and /dispatch/exceptions/:id/resolve", () => {
    it("reassign sends a signed, idempotent request to the dispatch API and audits the actor", async () => {
      configure();
      const j = await seedJob(org, { status: "assigned" });
      reply = { status: 200, body: { id: j.jobId, status: "offered", rider_phone: "+911111111111" } };
      const res = await request(app).post(`/api/dispatch/jobs/${j.jobId}/reassign`).set(bearer(ops)).set("Idempotency-Key", `reassign-${tag()}-key`).send({ reason: "Rider unreachable" });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe("offered");
      expect(seen).toHaveLength(1);
      const s = seen[0];
      expect(s.method).toBe("POST");
      expect(s.url).toBe(`/api/dispatch/jobs/${j.jobId}/reassign`);
      expect(s.headers.authorization).toBe(`Bearer ${SERVICE_TOKEN}`);
      expect(s.headers["idempotency-key"]).toMatch(/^reassign-/);
      expect(JSON.parse(s.body)).toEqual({ reason: "Rider unreachable" });
      const ts = s.headers["x-timestamp"] as string;
      expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(10);
      const expected = createHmac("sha256", SIGNING_SECRET).update(`POST\n${s.url}\n${ts}\n${createHash("sha256").update(s.body).digest("hex")}`).digest("hex");
      expect(s.headers["x-signature"]).toBe(expected);
      const audit = await query("SELECT actor_user_id, after FROM audit_logs WHERE action = 'dispatch.job_reassign' AND entity_id = $1;", [j.jobId]);
      expect(audit.rows[0].actor_user_id).toBe(ops.id);
      expect(audit.rows[0].after.reason).toBe("Rider unreachable");
    });
    it("cancel passes the dispatch cancel code and the job version", async () => {
      configure();
      const j = await seedJob(org, { status: "assigned" });
      const res = await request(app).post(`/api/dispatch/jobs/${j.jobId}/cancel`).set(bearer(ops)).send({ reason: "Customer phoned to cancel", code: "customer_cancelled" });
      expect(res.status).toBe(200);
      expect(JSON.parse(seen[0].body)).toEqual({ reason: "customer_cancelled", expected_version: 1 });
      expect(seen[0].headers["idempotency-key"]).toMatch(/^[\w:.-]{8,200}$/);
    });
    it("resolve exception forwards outcome and note", async () => {
      configure();
      const j = await seedJob(org, { status: "exception" });
      const ex = await query<{ id: string }>("INSERT INTO delivery_exceptions (job_id, kind, status) VALUES ($1, 'other', 'open') RETURNING id;", [j.jobId]);
      const res = await request(app).post(`/api/dispatch/exceptions/${ex.rows[0].id}/resolve`).set(bearer(ops)).send({ outcome: "reassign", note: "Handing to another rider" });
      expect(res.status).toBe(200);
      expect(seen[0].url).toBe(`/api/dispatch/exceptions/${ex.rows[0].id}/resolve`);
      expect(JSON.parse(seen[0].body)).toEqual({ outcome: "reassign", note: "Handing to another rider" });
    });
    it("maps a dispatch refusal to the same status and code (already_picked_up -> 409)", async () => {
      configure();
      const j = await seedJob(org, { status: "picked_up" });
      reply = { status: 409, body: { detail: "The order is already on its way.", code: "already_picked_up" } };
      const res = await request(app).post(`/api/dispatch/jobs/${j.jobId}/reassign`).set(bearer(ops)).send({ reason: "try anyway" });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ message: "The order is already on its way.", errorCode: "already_picked_up" });
    });
    it("a dispatch server fault is a 502; a rejected credential is a 502 that never echoes secrets", async () => {
      configure();
      const j = await seedJob(org, { status: "assigned" });
      reply = { status: 500, body: { detail: "boom internals", code: "x" } };
      const a = await request(app).post(`/api/dispatch/jobs/${j.jobId}/reassign`).set(bearer(ops)).send({ reason: "retry me" });
      expect(a.status).toBe(502);
      expect(JSON.stringify(a.body)).not.toMatch(/boom|svc-token|signing-secret/);
      reply = { status: 401, body: { detail: "nope", code: "bad_signature" } };
      const b = await request(app).post(`/api/dispatch/jobs/${j.jobId}/reassign`).set(bearer(ops)).send({ reason: "retry me" });
      expect(b.status).toBe(502);
      expect(b.body.errorCode).toBe("dispatch_credential_rejected");
    });
    it("503 provider_not_configured when the environment is missing or the service is unreachable", async () => {
      const j = await seedJob(org, { status: "assigned" });
      for (const k of ["DISPATCH_API_URL", "DISPATCH_SERVICE_TOKEN", "DISPATCH_SIGNING_SECRET"]) delete process.env[k];
      const missing = await request(app).post(`/api/dispatch/jobs/${j.jobId}/reassign`).set(bearer(ops)).send({ reason: "no env" });
      expect(missing.status).toBe(503);
      expect(missing.body.errorCode).toBe("provider_not_configured");
      process.env.DISPATCH_API_URL = "http://127.0.0.1:1";
      process.env.DISPATCH_SERVICE_TOKEN = SERVICE_TOKEN;
      process.env.DISPATCH_SIGNING_SECRET = SIGNING_SECRET;
      const down = await request(app).post(`/api/dispatch/jobs/${j.jobId}/cancel`).set(bearer(ops)).send({ reason: "unreachable" });
      expect(down.status).toBe(503);
      expect(down.body.errorCode).toBe("provider_not_configured");
      expect(JSON.stringify(down.body)).not.toMatch(/127\.0\.0\.1|svc-token/);
      const audit = await query("SELECT 1 FROM audit_logs WHERE action LIKE 'dispatch.%' AND entity_id = $1;", [j.jobId]);
      expect(audit.rows).toHaveLength(0); // nothing happened, nothing audited as done
    });
    it("validates input before calling out: reason required, cancel code enum, outcome enum, unknown job 404", async () => {
      configure();
      const j = await seedJob(org, { status: "assigned" });
      expect((await request(app).post(`/api/dispatch/jobs/${j.jobId}/reassign`).set(bearer(ops)).send({})).status).toBe(400);
      expect((await request(app).post(`/api/dispatch/jobs/${j.jobId}/cancel`).set(bearer(ops)).send({ reason: "fine reason", code: "because" })).status).toBe(400);
      expect((await request(app).post(`/api/dispatch/exceptions/${j.jobId}/resolve`).set(bearer(ops)).send({ outcome: "explode" })).status).toBe(400);
      expect((await request(app).post("/api/dispatch/jobs/00000000-0000-0000-0000-0000000000b3/reassign").set(bearer(ops)).send({ reason: "no such job" })).status).toBe(404);
      expect((await request(app).post("/api/dispatch/exceptions/00000000-0000-0000-0000-0000000000b4/resolve").set(bearer(ops)).send({ outcome: "resume" })).status).toBe(404);
      expect(seen).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------- audit
  describe("GET /audit-logs", () => {
    it("filters by actor, entity type/id, org and time; redacts secrets; paginates", async () => {
      await request(app).patch(`/api/organizations/${org}/ordering`).set(bearer(sa)).send({ accepting: true, reason: "Audit test" });
      const res = await request(app).get("/api/audit-logs").query({ actor: sa.id, entity_type: "organizations", entity_id: org, org }).set(bearer(ops));
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeGreaterThanOrEqual(1);
      expect(res.body.logs[0]).toMatchObject({ actor_user_id: sa.id, entity_id: org });
      expect(res.body.logs[0].actor_name).toBeTruthy();
      expect((await request(app).get("/api/audit-logs").query({ org, from: "2100-01-01" }).set(bearer(ops))).body.logs).toHaveLength(0);
      const p = await request(app).get("/api/audit-logs").query({ org, limit: 1 }).set(bearer(ops));
      expect(p.body.logs).toHaveLength(1);
      expect(p.body.pagination.limit).toBe(1);
    });
    it("scrubs secret-looking keys even if one was stored", async () => {
      await query(
        `INSERT INTO audit_logs (organization_id, actor_db_role, action, entity_type, entity_id, after) VALUES ($1, 'test', 'test.secret', 'probe', $2, $3::jsonb);`,
        [org, `probe-${tag()}`, JSON.stringify({ ok: 1, otp_hash: "abc", nested: { api_key: "k", token: "t", fine: 2 } })]
      );
      const res = await request(app).get("/api/audit-logs").query({ org, entity_type: "probe" }).set(bearer(ops));
      expect(res.body.logs[0].after).toEqual({ ok: 1, nested: { fine: 2 } });
    });
    it("rejects bad filters (400)", async () => {
      expect((await request(app).get("/api/audit-logs").query({ actor: "me" }).set(bearer(ops))).status).toBe(400);
      expect((await request(app).get("/api/audit-logs").query({ from: "soon" }).set(bearer(ops))).status).toBe(400);
      expect((await request(app).get("/api/audit-logs").query({ page: "-1" }).set(bearer(ops))).status).toBe(400);
    });
  });
});
