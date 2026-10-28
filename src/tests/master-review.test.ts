/**
 * Partner applications queue (approve creates the organisation, 0342) and the held-orders queue (decisions go through
 * the One Local admin API, stubbed here as a fake One Local that checks the caller's own session is forwarded).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, seedCity, tag } from "./helpers/master-kit";

let phoneSeq = Math.floor(Math.random() * 9000000);
const phone = () => `98${String(10000000 + (phoneSeq++ % 89999999)).padStart(8, "0")}`;

async function seedApplication(city: string, o: { email?: string | null; status?: string; user?: string | null; name?: string } = {}) {
  const r = await query<{ id: string }>(
    `INSERT INTO ol_partner_applications (city_id, business_name, business_type, partner_type, address, pin_code, owner_name, phone, email,
                                          consent_version, consent_at, submit_key, status, category_family, category, categories, subcategories, applicant_user_id)
     VALUES ($1, $2, 'grocery', 'store', 'Station Road, Latur', '413512', 'Asha Patil', $3, $4, 'v1', now(), $5, $6,
             'Grocery and daily needs', 'Grocery', '{Grocery,Dairy}', '{Supermarket}', $7) RETURNING id;`,
    [city, o.name ?? `Review Mart ${tag()}`, phone(), o.email === undefined ? `apply-${tag()}@test.local` : o.email, `rk-${tag()}-${tag()}`, o.status ?? "submitted", o.user ?? null]
  );
  return r.rows[0].id;
}
/** Operations' four checks (0371/0372): approval is refused until every one is verified. */
async function verifyChecks(applicationId: string, by: string) {
  await query(
    `INSERT INTO ol_partner_application_checks (application_id, kind, status, decided_by, decided_at)
     SELECT $1, k, 'verified', $2, now() FROM unnest(ARRAY['individual_identity','business_identity','business_address','bank_ownership']) AS k;`,
    [applicationId, by]
  );
}
async function seedLogin(email: string, confirmed = true): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, $2) RETURNING id;`,
    [email, confirmed ? new Date() : null]
  );
  return r.rows[0].id;
}

describe("Master: partner applications", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  const orgIds: string[] = [];
  let sa: TestStaff;
  let reviewer: TestStaff; // partner review only, not super admin
  let viewer: TestStaff; // can see the queue, cannot decide
  let city: string;

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin" });
    reviewer = await staffWith({ feat_partner_review: ["view_applications", "approve_partner", "reject_partner"] }, roleKeys);
    viewer = await staffWith({ feat_partner_review: ["view_applications"] }, roleKeys);
    staffIds.push(sa.id, reviewer.id, viewer.id);
    city = await seedCity();
  });
  afterAll(async () => {
    const orgs = await query<{ organization_id: string }>(`SELECT organization_id FROM ol_partner_applications WHERE city_id = $1 AND organization_id IS NOT NULL;`, [city]);
    orgIds.push(...orgs.rows.map((o) => o.organization_id));
    await query(`DELETE FROM ol_partner_applications WHERE city_id = $1;`, [city]);
    await query(`DELETE FROM org_invitations WHERE organization_id = ANY($1::uuid[]);`, [orgIds]).catch(() => undefined);
    await query(`DELETE FROM org_users WHERE organization_id = ANY($1::uuid[]);`, [orgIds]).catch(() => undefined);
    await cleanup({ orgIds, staffIds, roleKeys });
    await query(`DELETE FROM ol_service_areas WHERE city_id = $1;`, [city]).catch(() => undefined);
  });

  it("lists with status, q filters, counts and pagination; drafts are listed under their own status", async () => {
    const a = await seedApplication(city, { name: "Zephyr Kirana Finder" });
    await seedApplication(city, { status: "draft" });
    const all = await request(app).get("/api/partner-applications").query({ city }).set(bearer(viewer));
    expect(all.status).toBe(200);
    expect(all.body.pagination.total).toBe(2);
    const sub = await request(app).get("/api/partner-applications").query({ city, status: "submitted" }).set(bearer(viewer));
    expect(sub.body.applications.map((r: { id: string }) => r.id)).toEqual([a]);
    expect(sub.body.applications[0].categories).toEqual(["Grocery", "Dairy"]);
    const q = await request(app).get("/api/partner-applications").query({ city, q: "zephyr kirana" }).set(bearer(viewer));
    expect(q.body.applications).toHaveLength(1);
    expect(q.body.counts.submitted).toBeGreaterThanOrEqual(1);
    const bad = await request(app).get("/api/partner-applications").query({ status: "approvedish" }).set(bearer(viewer));
    expect(bad.status).toBe(400);
  });

  it("detail shows every submitted field incl. all categories, never the submit key, and the login the approval would link", async () => {
    const email = `match-${tag()}@test.local`;
    staffIds.push(await seedLogin(email));
    const id = await seedApplication(city, { email });
    const res = await request(app).get(`/api/partner-applications/${id}`).set(bearer(viewer));
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ id, address: "Station Road, Latur", pin_code: "413512", categories: ["Grocery", "Dairy"], subcategories: ["Supermarket"], category_family: "Grocery and daily needs" });
    expect(res.body.application.submit_key).toBeUndefined();
    expect(res.body.login_match).toEqual({ found: true, confirmed: true });
    const missing = await request(app).get(`/api/partner-applications/00000000-0000-0000-0000-0000000000aa`).set(bearer(viewer));
    expect(missing.status).toBe(404);
  });

  it("a viewer cannot approve or reject (403)", async () => {
    const id = await seedApplication(city);
    expect((await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(viewer)).send({})).status).toBe(403);
    expect((await request(app).post(`/api/partner-applications/${id}/reject`).set(bearer(viewer)).send({ reason: "No" })).status).toBe(403);
  });

  it("approve creates the organisation, links the website applicant by email as org_owner, and audits", async () => {
    const email = `owner-${tag()}@test.local`;
    const login = await seedLogin(email);
    staffIds.push(login);
    const id = await seedApplication(city, { email });
    await verifyChecks(id, reviewer.id);
    const res = await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(reviewer)).send({ reason: "Shop visited" });
    expect(res.status).toBe(200);
    const out = res.body.result;
    expect(out).toMatchObject({ status: "approved", replayed: false, applicant_user_id: login, owner_membership: true });
    const app2 = await query(`SELECT status, organization_id, reviewed_by, reviewed_at, review_note, applicant_user_id FROM ol_partner_applications WHERE id = $1;`, [id]);
    expect(app2.rows[0]).toMatchObject({ status: "approved", organization_id: out.organization_id, reviewed_by: reviewer.id, review_note: "Shop visited", applicant_user_id: login });
    const org = await query(`SELECT control_status, contact_email FROM organizations WHERE id = $1;`, [out.organization_id]);
    expect(org.rows[0]).toMatchObject({ control_status: "Approved", contact_email: email });
    const owner = await query(`SELECT 1 FROM org_users ou JOIN roles ro ON ro.id = ou.role_id WHERE ou.organization_id = $1 AND ou.user_id = $2 AND ro.slug = 'org_owner';`, [out.organization_id, login]);
    expect(owner.rowCount).toBe(1);
    const audit = await query(`SELECT actor_user_id FROM audit_logs WHERE action = 'partner_application.approved' AND entity_id = $1;`, [id]);
    expect(audit.rows).toEqual([{ actor_user_id: reviewer.id }]);
  });

  it("approving twice, even at the same moment, makes exactly one organisation", async () => {
    const id = await seedApplication(city);
    await verifyChecks(id, sa.id);
    const [a, b] = await Promise.all([
      request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(sa)).send({}),
      request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(sa)).send({}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.result.organization_id).toBe(b.body.result.organization_id);
    expect([a.body.result.replayed, b.body.result.replayed].sort()).toEqual([false, true]);
    const again = await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(sa)).send({});
    expect(again.body.result).toMatchObject({ organization_id: a.body.result.organization_id, replayed: true });
    const n = await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'partner_application.approved' AND entity_id = $1;`, [id]);
    expect(n.rows[0].n).toBe(1);
  });

  it("with no login the owner is invited instead", async () => {
    const id = await seedApplication(city);
    await verifyChecks(id, reviewer.id);
    const res = await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(reviewer)).send({});
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ owner_membership: false, applicant_user_id: null });
    expect(res.body.result.invitation_id).toBeTruthy();
  });

  it("approve is refused (400 ol_checks_pending) until all four checks are verified", async () => {
    const id = await seedApplication(city);
    const res = await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(reviewer)).send({});
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("ol_checks_pending");
    const row = await query(`SELECT status, organization_id FROM ol_partner_applications WHERE id = $1;`, [id]);
    expect(row.rows[0]).toEqual({ status: "submitted", organization_id: null });
  });

  it("reject needs a reason, records it, and is final", async () => {
    const id = await seedApplication(city);
    expect((await request(app).post(`/api/partner-applications/${id}/reject`).set(bearer(reviewer)).send({})).status).toBe(400);
    const res = await request(app).post(`/api/partner-applications/${id}/reject`).set(bearer(reviewer)).send({ reason: "Outside our service area" });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ status: "rejected", organization_id: null });
    const row = await query(`SELECT status, review_note FROM ol_partner_applications WHERE id = $1;`, [id]);
    expect(row.rows[0]).toEqual({ status: "rejected", review_note: "Outside our service area" });
    const approve = await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(reviewer)).send({});
    expect(approve.status).toBe(409);
    expect(approve.body.errorCode).toBe("ol_wrong_state");
  });

  it("a draft cannot be decided (409) and an unknown id is 404", async () => {
    const id = await seedApplication(city, { status: "draft" });
    const res = await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(reviewer)).send({});
    expect(res.status).toBe(409);
    const missing = await request(app).post(`/api/partner-applications/00000000-0000-0000-0000-0000000000ab/reject`).set(bearer(reviewer)).send({ reason: "Gone" });
    expect(missing.status).toBe(404);
  });

  // ------------------------------------------------ checks, documents and hold in Master (0630)
  async function seedDocument(applicationId: string, kind: string) {
    const r = await query<{ id: string }>(
      `INSERT INTO ol_partner_application_documents (application_id, kind, storage_path, file_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, 'doc.pdf', 'application/pdf', 1000) RETURNING id;`,
      [applicationId, kind, `apps/${applicationId}/${kind}.pdf`]
    );
    return r.rows[0].id;
  }

  it("detail lists the four checks (missing = pending), documents without their path, and the bank as last four only", async () => {
    const id = await seedApplication(city);
    await seedDocument(id, "pan_copy");
    await query(
      `INSERT INTO ol_partner_application_bank (application_id, holder_name, bank_name, account_last4, account_enc, ifsc, account_type, status)
       VALUES ($1, 'Asha Patil', 'State Bank', '4321', '\\x00'::bytea, 'SBIN0001234', 'savings', 'unverified');`,
      [id]
    );
    const res = await request(app).get(`/api/partner-applications/${id}`).set(bearer(viewer));
    expect(res.status).toBe(200);
    expect(res.body.checks.map((c: { kind: string; status: string }) => [c.kind, c.status])).toEqual([
      ["individual_identity", "pending"],
      ["business_identity", "pending"],
      ["business_address", "pending"],
      ["bank_ownership", "pending"],
    ]);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].storage_path).toBeUndefined();
    expect(res.body.bank).toMatchObject({ account_last4: "4321", status: "unverified" });
    expect(JSON.stringify(res.body.bank)).not.toContain("account_enc");
    expect(res.body.hold).toBeNull();
  });

  it("checks: a viewer cannot set them (403); failed needs a note; verified is recorded with who", async () => {
    const granted = await staffWith({ feat_partner_review: ["view_applications", "verify_checks"] }, roleKeys);
    staffIds.push(granted.id);
    const id = await seedApplication(city);
    expect((await request(app).post(`/api/partner-applications/${id}/checks/business_identity`).set(bearer(viewer)).send({ status: "verified" })).status).toBe(403);
    expect((await request(app).post(`/api/partner-applications/${id}/checks/business_identity`).set(bearer(granted)).send({ status: "failed" })).status).toBe(400);
    expect((await request(app).post(`/api/partner-applications/${id}/checks/not_a_check`).set(bearer(granted)).send({ status: "verified" })).status).toBe(400);
    const ok = await request(app).post(`/api/partner-applications/${id}/checks/business_identity`).set(bearer(granted)).send({ status: "verified" });
    expect(ok.status).toBe(200);
    const row = await query(`SELECT status, decided_by FROM ol_partner_application_checks WHERE application_id = $1 AND kind = 'business_identity';`, [id]);
    expect(row.rows[0]).toEqual({ status: "verified", decided_by: granted.id });
  });

  it("documents: reject needs a note, a document of another application is 404, and approval waits for every document", async () => {
    const id = await seedApplication(city);
    const other = await seedApplication(city);
    const doc = await seedDocument(id, "pan_copy");
    const foreign = await seedDocument(other, "pan_copy");
    await verifyChecks(id, reviewer.id);
    expect((await request(app).post(`/api/partner-applications/${id}/documents/${doc}/review`).set(bearer(sa)).send({ status: "rejected" })).status).toBe(400);
    expect((await request(app).post(`/api/partner-applications/${id}/documents/${foreign}/review`).set(bearer(sa)).send({ status: "verified" })).status).toBe(404);
    const blocked = await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(sa)).send({});
    expect(blocked.status).toBe(400);
    expect(blocked.body.errorCode).toBe("ol_docs_pending");
    expect((await request(app).post(`/api/partner-applications/${id}/documents/${doc}/review`).set(bearer(sa)).send({ status: "verified" })).status).toBe(200);
    const approved = await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(sa)).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.result.status).toBe("approved");
  });

  it("viewing a document is recorded even when the file is missing, and the response never carries the storage path", async () => {
    const id = await seedApplication(city);
    const doc = await seedDocument(id, "business_proof");
    const res = await request(app).post(`/api/partner-applications/${id}/documents/${doc}/view`).set(bearer(sa));
    expect([200, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain(`apps/${id}`);
    const audit = await query(`SELECT actor_user_id FROM audit_logs WHERE action = 'partner_application.document_viewed' AND entity_id = $1;`, [id]);
    expect(audit.rows).toEqual([{ actor_user_id: sa.id }]);
  });

  it("hold: needs a reason, refused before approval, and holds then releases an approved partner", async () => {
    const id = await seedApplication(city);
    expect((await request(app).post(`/api/partner-applications/${id}/hold`).set(bearer(sa)).send({ hold: true })).status).toBe(400);
    const early = await request(app).post(`/api/partner-applications/${id}/hold`).set(bearer(sa)).send({ hold: true, reason: "Checking documents" });
    expect(early.status).toBe(400);
    await verifyChecks(id, reviewer.id);
    const org = (await request(app).post(`/api/partner-applications/${id}/approve`).set(bearer(sa)).send({})).body.result.organization_id;
    await query(`INSERT INTO ol_merchant_channels (organization_id, accepting) VALUES ($1, false) ON CONFLICT DO NOTHING;`, [org]);
    const held = await request(app).post(`/api/partner-applications/${id}/hold`).set(bearer(sa)).send({ hold: true, reason: "Customer complaints" });
    expect(held.status).toBe(200);
    const detail = await request(app).get(`/api/partner-applications/${id}`).set(bearer(sa));
    expect(detail.body.hold).toMatchObject({ platform_hold: true, platform_hold_reason: "Customer complaints" });
    const released = await request(app).post(`/api/partner-applications/${id}/hold`).set(bearer(sa)).send({ hold: false, reason: "Resolved" });
    expect(released.status).toBe(200);
    expect((await query(`SELECT platform_hold FROM ol_merchant_channels WHERE organization_id = $1;`, [org])).rows[0].platform_hold).toBe(false);
    await query(`DELETE FROM ol_merchant_channels WHERE organization_id = $1;`, [org]).catch(() => undefined);
  });
});

describe("Master: order holds", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  const holdIds: string[] = [];
  const orderIds: string[] = [];
  let sa: TestStaff;
  let ops: TestStaff; // orders view + decide
  let viewer: TestStaff; // orders view only
  const realUrl = process.env.ONE_LOCAL_API_URL;

  async function seedHold(reasons: unknown[] = [{ code: "line_qty", item: "Burger", qty: 10, limit: 8 }]) {
    const o = await query<{ id: string }>(
      `INSERT INTO ol_orders (customer_hash, items, subtotal, total, city_id, payment_method) VALUES ($1, '[]'::jsonb, 1000, 1000, 'latur', 'cod') RETURNING id;`,
      [`h${tag()}`]
    );
    orderIds.push(o.rows[0].id);
    await query(`INSERT INTO ol_order_items (order_id, product_id, name, price, mrp, qty) VALUES ($1, null, 'Classic Burger', 100, 100, 10);`, [o.rows[0].id]);
    const h = await query<{ id: string }>(`INSERT INTO ol_order_holds (order_id, reasons) VALUES ($1, $2::jsonb) RETURNING id;`, [o.rows[0].id, JSON.stringify(reasons)]);
    holdIds.push(h.rows[0].id);
    return h.rows[0].id;
  }

  /** A fake One Local admin API: checks the forwarded session, then decides the hold the way server/order-risk.ts does. */
  function fakeOneLocal(opts: { status?: number; body?: Record<string, unknown> } = {}) {
    const calls: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
    const fake = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = JSON.parse(String(init.body ?? "{}"));
      calls.push({ url, auth: headers.Authorization ?? null, body });
      if (opts.status && opts.status !== 200) return new Response(JSON.stringify(opts.body ?? {}), { status: opts.status });
      const id = url.split("/").pop()!;
      const status = body.decision === "release" ? "released" : "rejected";
      const r = await query<{ order_id: string }>(
        `UPDATE ol_order_holds SET status = $2, decided_at = now(), note = $3 WHERE id = $1 AND status = 'held' RETURNING order_id;`,
        [id, status, body.note]
      );
      return new Response(JSON.stringify({ order_id: r.rows[0]?.order_id, status }), { status: 200 });
    });
    vi.stubGlobal("fetch", fake);
    return calls;
  }

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin" });
    ops = await staffWith({ feat_orders: ["view_orders", "decide_order_holds"] }, roleKeys);
    viewer = await staffWith({ feat_orders: ["view_orders"] }, roleKeys);
    staffIds.push(sa.id, ops.id, viewer.id);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (realUrl === undefined) delete process.env.ONE_LOCAL_API_URL;
    else process.env.ONE_LOCAL_API_URL = realUrl;
  });
  afterAll(async () => {
    // Holds and items go with the order. The delete guard wants a reason from the owner role, set in this same statement.
    await query(
      `WITH r AS (SELECT set_config('app.ol_order_delete_reason', 'master-review test cleanup', true))
       DELETE FROM ol_orders WHERE id = ANY($1::uuid[]) AND EXISTS (SELECT 1 FROM r);`,
      [orderIds]
    );
    await cleanup({ staffIds, roleKeys });
  });

  it("lists open holds oldest first with order facts, and shows one hold with its items", async () => {
    const a = await seedHold();
    const b = await seedHold([{ code: "orders_per_hour", limit: 3, recent: 3 }]);
    const res = await request(app).get("/api/order-holds").query({ status: "held", limit: 100 }).set(bearer(viewer));
    expect(res.status).toBe(200);
    const ids = res.body.holds.map((h: { id: string }) => h.id);
    expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b));
    const row = res.body.holds.find((h: { id: string }) => h.id === a);
    expect(row).toMatchObject({ status: "held", item_lines: 1, item_qty: 10, payment_method: "cod" });
    expect(row.reasons[0].code).toBe("line_qty");
    const one = await request(app).get(`/api/order-holds/${a}`).set(bearer(viewer));
    expect(one.status).toBe(200);
    expect(one.body.items).toEqual([expect.objectContaining({ name: "Classic Burger", qty: 10 })]);
    expect((await request(app).get(`/api/order-holds/00000000-0000-0000-0000-0000000000ac`).set(bearer(viewer))).status).toBe(404);
  });

  it("a viewer cannot decide (403); a reason is required (400)", async () => {
    const id = await seedHold();
    expect((await request(app).post(`/api/order-holds/${id}/release`).set(bearer(viewer)).send({ reason: "Checked" })).status).toBe(403);
    expect((await request(app).post(`/api/order-holds/${id}/release`).set(bearer(ops)).send({})).status).toBe(400);
  });

  it("without One Local connected a decision is 503 and nothing changes", async () => {
    delete process.env.ONE_LOCAL_API_URL;
    const id = await seedHold();
    const res = await request(app).post(`/api/order-holds/${id}/release`).set(bearer(ops)).send({ reason: "Customer confirmed by phone" });
    expect(res.status).toBe(503);
    expect(res.body.errorCode).toBe("provider_not_configured");
    expect((await query(`SELECT status FROM ol_order_holds WHERE id = $1;`, [id])).rows[0].status).toBe("held");
  });

  it("release goes through One Local with the caller's own session, then is audited", async () => {
    process.env.ONE_LOCAL_API_URL = "http://one-local.test/";
    const calls = fakeOneLocal();
    const id = await seedHold();
    const res = await request(app).post(`/api/order-holds/${id}/release`).set(bearer(sa)).send({ reason: "Customer confirmed by phone" });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ hold_id: id, status: "released" });
    expect(calls).toEqual([{ url: `http://one-local.test/api/admin/order-holds/${id}`, auth: `Bearer ${sa.token}`, body: { decision: "release", note: "Customer confirmed by phone" } }]);
    const audit = await query(`SELECT actor_user_id, after FROM audit_logs WHERE action = 'order_hold.released' AND entity_id = $1;`, [id]);
    expect(audit.rows[0].actor_user_id).toBe(sa.id);
    expect(audit.rows[0].after).toMatchObject({ decision: "release", reason: "Customer confirmed by phone" });
    // decided: a second decision is refused here, before One Local is called again
    const again = await request(app).post(`/api/order-holds/${id}/reject`).set(bearer(sa)).send({ reason: "Too late" });
    expect(again.status).toBe(409);
    expect(calls).toHaveLength(1);
  });

  it("reject goes through One Local and is audited", async () => {
    process.env.ONE_LOCAL_API_URL = "http://one-local.test";
    const calls = fakeOneLocal();
    const id = await seedHold();
    const res = await request(app).post(`/api/order-holds/${id}/reject`).set(bearer(ops)).send({ reason: "Fake order pattern" });
    expect(res.status).toBe(200);
    expect(calls[0].body).toEqual({ decision: "reject", note: "Fake order pattern" });
    expect((await query(`SELECT status FROM ol_order_holds WHERE id = $1;`, [id])).rows[0].status).toBe("rejected");
    expect((await query(`SELECT 1 FROM audit_logs WHERE action = 'order_hold.rejected' AND entity_id = $1;`, [id])).rowCount).toBe(1);
  });

  it("One Local refusing the staff member (not its super admin) is a 403 with nothing audited", async () => {
    process.env.ONE_LOCAL_API_URL = "http://one-local.test";
    fakeOneLocal({ status: 403, body: { code: "not_platform_admin", detail: "Only One Local platform admins can use this." } });
    const id = await seedHold();
    const res = await request(app).post(`/api/order-holds/${id}/release`).set(bearer(ops)).send({ reason: "Checked the basket" });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("one_local_forbidden");
    expect((await query(`SELECT 1 FROM audit_logs WHERE entity_id = $1;`, [id])).rowCount).toBe(0);
  });
});
