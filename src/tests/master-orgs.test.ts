import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, createOrg, cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, seedPlan, seedOrder, seedJob, wipeOrgData, tag } from "./helpers/master-kit";

describe("Master: shell, organization lifecycle, subscription, invitations", () => {
  const orgIds: string[] = [];
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  let sa: TestStaff;
  let orgStaff: TestStaff; // holds only the org-lifecycle + subscription + invitation actions (not super admin)
  const t = tag();

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin", firstName: "Ada", lastName: "Root" });
    orgStaff = await staffWith(
      {
        feat_org_360: ["view_directory", "create_org", "manage_ordering", "suspend_org", "archive_org"],
        feat_org_subscription: ["view_subscription", "change_plan"],
        feat_invitations: ["view_invitations", "manage_invitations"],
        feat_dashboard: ["view_dashboard"],
      },
      roleKeys
    );
    staffIds.push(sa.id, orgStaff.id);
    await seedPlan(`mk_plan_a_${t}`, { locations: 5, users: 20 });
    await seedPlan(`mk_plan_small_${t}`, { locations: 1, users: 20 });
  });
  afterAll(async () => {
    await wipeOrgData(orgIds);
    await query("DELETE FROM org_invitations WHERE organization_id = ANY($1::uuid[]);", [orgIds]).catch(() => undefined);
    await cleanup({ orgIds, staffIds, roleKeys });
    await query("DELETE FROM commercial_plans WHERE plan_code LIKE $1;", [`mk_plan_%_${t}`]);
  });

  // ------------------------------------------------------------------ shell
  describe("GET /me/context", () => {
    it("returns the user, role, permissions, environment and organizations", async () => {
      const res = await request(app).get("/api/me/context").set(bearer(orgStaff));
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(orgStaff.id);
      expect(res.body.is_super_admin).toBe(false);
      expect(res.body.environment).toBe("test");
      const ids = res.body.permissions.map((p: { id: string }) => p.id);
      expect(ids).toContain("feat_invitations");
      expect(ids).not.toContain("feat_finance");
      expect(Array.isArray(res.body.organizations)).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/password|token/i);
    });
    it("reports super admin", async () => {
      const res = await request(app).get("/api/me/context").set(bearer(sa));
      expect(res.body.is_super_admin).toBe(true);
    });
  });

  describe("GET /system/status", () => {
    it("reports db, queue, sync, approvals and environment", async () => {
      const res = await request(app).get("/api/system/status").set(bearer(orgStaff));
      expect(res.status).toBe(200);
      expect(res.body.db.ok).toBe(true);
      expect(res.body.queue).toHaveProperty("backlog");
      expect(res.body).toHaveProperty("pending_approvals");
      expect(res.body.environment).toBe("test");
    });
  });

  describe("GET /search", () => {
    it("returns grouped results and hides groups the staff member may not see", async () => {
      const org = await createOrg({ name: `SearchableOrg ${t}`, status: "Active" });
      orgIds.push(org);
      const res = await request(app).get("/api/search").query({ q: `SearchableOrg ${t}` }).set(bearer(orgStaff));
      expect(res.status).toBe(200);
      expect(res.body.results.organizations.map((o: { id: string }) => o.id)).toContain(org);
      expect(res.body.results.riders).toEqual([]); // no feat_riders
      expect(res.body.results.payouts).toEqual([]);
      const full = await request(app).get("/api/search").query({ q: `SearchableOrg ${t}` }).set(bearer(sa));
      expect(Object.keys(full.body.results).sort()).toEqual(["orders", "organizations", "payouts", "riders", "settlements", "users"]);
    });
    it("rejects a missing or too-short query (400)", async () => {
      expect((await request(app).get("/api/search").set(bearer(sa))).status).toBe(400);
      const short = await request(app).get("/api/search").query({ q: "a" }).set(bearer(sa));
      expect(short.status).toBe(400);
      expect(short.body.errorCode).toBe("VALIDATION_ERROR");
    });
    it("treats LIKE wildcards literally", async () => {
      const res = await request(app).get("/api/search").query({ q: "%%" }).set(bearer(sa));
      expect(res.status).toBe(200);
      expect(res.body.results.organizations).toEqual([]);
    });
  });

  describe("GET /dashboard/summary", () => {
    it("returns the operational summary with money as minor units plus currency", async () => {
      const org = await createOrg({ status: "Active" });
      orgIds.push(org);
      await seedOrder(org, { total: 250 });
      const res = await request(app).get("/api/dashboard/summary").query({ org }).set(bearer(orgStaff));
      expect(res.status).toBe(200);
      const s = res.body.summary;
      expect(s.orders_count).toBe(1);
      expect(s.gmv_minor).toBe(25000);
      expect(s.currency_code).toBe("INR");
      for (const k of ["riders_online", "active_deliveries", "failed_deliveries", "late_deliveries", "pending_approvals", "open_exceptions", "settlements_pending", "payouts_pending", "failed_payments"]) {
        expect(s).toHaveProperty(k);
      }
    });
    it("rejects an inverted period (400 master_bad_period) and a malformed date", async () => {
      const bad = await request(app).get("/api/dashboard/summary").query({ from: "2026-02-01", to: "2026-01-01" }).set(bearer(sa));
      expect(bad.status).toBe(400);
      expect(bad.body.errorCode).toBe("master_bad_period");
      expect((await request(app).get("/api/dashboard/summary").query({ from: "not-a-date" }).set(bearer(sa))).status).toBe(400);
    });
  });

  // ---------------------------------------------------- POST /organizations
  describe("POST /organizations (extended create)", () => {
    const body = (n: number, extra: Record<string, unknown> = {}) => ({
      business_name: `Ext Org ${t} ${n}`,
      domain: "Restaurant",
      email: `ext-${t}-${n}@test.local`,
      phone_number: `+9177${String(n).padStart(2, "0")}${t.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}`,
      ...extra,
    });

    it("creates with plan, owner invitation, extra locations and ordering open", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set(bearer(orgStaff))
        .send(body(1, { status: "Active", plan_code: `mk_plan_a_${t}`, owner_email: `owner-${t}@test.local`, locations: [{ name: "Second Outlet" }, { name: "Third Outlet" }], ordering_open: true }));
      expect(res.status).toBe(403); // orgStaff may create but not set status Active (partner review approve action)
      const ok = await request(app)
        .post("/api/organizations")
        .set(bearer(sa))
        .send(body(1, { status: "Active", plan_code: `mk_plan_a_${t}`, owner_email: `owner-${t}@test.local`, locations: [{ name: "Second Outlet" }, { name: "Third Outlet" }], ordering_open: true }));
      expect(ok.status).toBe(201);
      const id = ok.body.organization.id;
      orgIds.push(id);
      expect(ok.body.locations).toHaveLength(2);
      expect(ok.body.warnings).toEqual([]);
      expect(ok.body.ordering.accepting).toBe(true);
      const sub = await query("SELECT 1 FROM subscriptions s JOIN commercial_plans p ON p.id = s.plan_id WHERE s.organization_id = $1 AND p.plan_code = $2;", [id, `mk_plan_a_${t}`]);
      expect(sub.rows).toHaveLength(1);
      const inv = await query("SELECT 1 FROM org_invitations WHERE organization_id = $1 AND lower(email) = $2;", [id, `owner-${t}@test.local`]);
      expect(inv.rows).toHaveLength(1);
      const audit = await query("SELECT actor_user_id FROM audit_logs WHERE action = 'master.organization_created' AND entity_id = $1;", [id]);
      expect(audit.rows[0].actor_user_id).toBe(sa.id);
    });

    it("a staff member with create_org (Draft) can create a plain organization", async () => {
      const res = await request(app).post("/api/organizations").set(bearer(orgStaff)).send(body(2));
      expect(res.status).toBe(201);
      orgIds.push(res.body.organization.id);
      expect(res.body.organization.status).toBe("Draft");
    });

    it("rejects an unknown plan (400) and writes no organization", async () => {
      const res = await request(app).post("/api/organizations").set(bearer(sa)).send(body(3, { plan_code: "no_such_plan" }));
      expect(res.status).toBe(400);
      const n = await query("SELECT 1 FROM organizations WHERE contact_email = $1;", [`ext-${t}-3@test.local`]);
      expect(n.rows).toHaveLength(0);
    });

    it("rejects ordering_open on a Draft organization and bad owner email / bad location payload (400)", async () => {
      expect((await request(app).post("/api/organizations").set(bearer(sa)).send(body(4, { ordering_open: true }))).status).toBe(400);
      expect((await request(app).post("/api/organizations").set(bearer(sa)).send(body(5, { owner_email: "not-an-email" }))).status).toBe(400);
      expect((await request(app).post("/api/organizations").set(bearer(sa)).send(body(6, { locations: [{ name: "x" }] }))).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- ordering
  describe("PATCH /organizations/:id/ordering", () => {
    let org: string;
    beforeAll(async () => {
      org = await createOrg({ status: "Active" });
      orgIds.push(org);
    });
    it("pauses and resumes ordering with a reason, attributed in the audit log", async () => {
      const open = await request(app).patch(`/api/organizations/${org}/ordering`).set(bearer(orgStaff)).send({ accepting: true, reason: "Go live" });
      expect(open.status).toBe(200);
      expect(open.body.accepting).toBe(true);
      const pause = await request(app).patch(`/api/organizations/${org}/ordering`).set(bearer(orgStaff)).send({ accepting: false, reason: "Kitchen closed" });
      expect(pause.body.accepting).toBe(false);
      const row = await query("SELECT accepting FROM ol_merchant_channels WHERE organization_id = $1;", [org]);
      expect(row.rows[0].accepting).toBe(false);
      const audit = await query("SELECT actor_user_id, after FROM audit_logs WHERE action = 'master.ordering_changed' AND entity_id = $1 ORDER BY id DESC LIMIT 1;", [org]);
      expect(audit.rows[0].actor_user_id).toBe(orgStaff.id);
      expect(audit.rows[0].after.reason).toBe("Kitchen closed");
    });
    it("rejects a missing reason / missing flag (400) and an unknown org (404)", async () => {
      expect((await request(app).patch(`/api/organizations/${org}/ordering`).set(bearer(sa)).send({ accepting: true })).status).toBe(400);
      expect((await request(app).patch(`/api/organizations/${org}/ordering`).set(bearer(sa)).send({ reason: "because" })).status).toBe(400);
      const nf = await request(app).patch("/api/organizations/00000000-0000-0000-0000-0000000000aa/ordering").set(bearer(sa)).send({ accepting: false, reason: "because" });
      expect(nf.status).toBe(404);
      expect(nf.body.errorCode).toBe("master_not_found");
    });
    it("refuses to resume ordering for a suspended organization (409)", async () => {
      const o2 = await createOrg({ status: "Active" });
      orgIds.push(o2);
      await request(app).post(`/api/organizations/${o2}/suspend`).set(bearer(sa)).send({ reason: "Fraud check" });
      const res = await request(app).patch(`/api/organizations/${o2}/ordering`).set(bearer(sa)).send({ accepting: true, reason: "try" });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe("master_suspended");
    });
  });

  // ------------------------------------------------- suspend/reactivate/archive
  describe("suspend, reactivate, archive, restore", () => {
    it("suspend then reactivate changes control status and shuts the organization out in the database", async () => {
      const org = await createOrg({ status: "Active" });
      orgIds.push(org);
      const s = await request(app).post(`/api/organizations/${org}/suspend`).set(bearer(orgStaff)).send({ reason: "Unpaid invoices" });
      expect(s.status).toBe(200);
      const st = await query<{ status: string; control_status: string; status_reason: string }>("SELECT status::text AS status, control_status, status_reason FROM organizations WHERE id = $1;", [org]);
      expect(st.rows[0]).toMatchObject({ status: "suspended", control_status: "Suspended", status_reason: "Unpaid invoices" });
      const again = await request(app).post(`/api/organizations/${org}/suspend`).set(bearer(sa)).send({ reason: "twice" });
      expect(again.body.changed).toBe(false); // idempotent
      const r = await request(app).post(`/api/organizations/${org}/reactivate`).set(bearer(orgStaff)).send({ reason: "Paid" });
      expect(r.status).toBe(200);
      const back = await query<{ status: string }>("SELECT status::text AS status FROM organizations WHERE id = $1;", [org]);
      expect(back.rows[0].status).toBe("active");
    });
    it("requires a reason (400) and 404s an unknown organization", async () => {
      const org = await createOrg({ status: "Active" });
      orgIds.push(org);
      const res = await request(app).post(`/api/organizations/${org}/suspend`).set(bearer(sa)).send({});
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_ERROR");
      const short = await request(app).post(`/api/organizations/${org}/suspend`).set(bearer(sa)).send({ reason: "x" });
      expect(short.status).toBe(400);
      const nf = await request(app).post("/api/organizations/00000000-0000-0000-0000-0000000000bb/reactivate").set(bearer(sa)).send({ reason: "because" });
      expect(nf.status).toBe(404);
    });
    it("archive is blocked while orders are open, then works; restore returns the previous status", async () => {
      const org = await createOrg({ status: "Active" });
      orgIds.push(org);
      await seedOrder(org, { status: "new" });
      const blocked = await request(app).post(`/api/organizations/${org}/archive`).set(bearer(orgStaff)).send({ reason: "Closing down" });
      expect(blocked.status).toBe(409);
      expect(blocked.body.errorCode).toBe("master_open_orders");
      await query("DELETE FROM orders WHERE organization_id = $1;", [org]);
      const ok = await request(app).post(`/api/organizations/${org}/archive`).set(bearer(orgStaff)).send({ reason: "Closing down" });
      expect(ok.status).toBe(200);
      const row = await query<{ archived_at: string | null; status: string }>("SELECT archived_at, status::text AS status FROM organizations WHERE id = $1;", [org]);
      expect(row.rows[0].archived_at).not.toBeNull();
      expect(row.rows[0].status).toBe("suspended");
      const act = await request(app).post(`/api/organizations/${org}/reactivate`).set(bearer(sa)).send({ reason: "oops" });
      expect(act.status).toBe(409);
      expect(act.body.errorCode).toBe("master_archived");
      const back = await request(app).post(`/api/organizations/${org}/restore`).set(bearer(orgStaff)).send({ reason: "Reopening" });
      expect(back.status).toBe(200);
      const after = await query<{ archived_at: string | null; control_status: string }>("SELECT archived_at, control_status FROM organizations WHERE id = $1;", [org]);
      expect(after.rows[0].archived_at).toBeNull();
      expect(after.rows[0].control_status).toBe("Active");
    });
    it("archive is blocked by an open delivery job too (409)", async () => {
      const org = await createOrg({ status: "Active" });
      orgIds.push(org);
      await seedJob(org, { status: "assigned" });
      const res = await request(app).post(`/api/organizations/${org}/archive`).set(bearer(sa)).send({ reason: "Closing down" });
      expect(res.status).toBe(409);
    });
  });

  // ----------------------------------------------------- 360, subscription
  describe("GET /organizations/:id/360 and subscription", () => {
    let org: string;
    beforeAll(async () => {
      org = await createOrg({ status: "Active" });
      orgIds.push(org);
      await seedOrder(org, { total: 100 });
    });
    it("returns the 360 read model", async () => {
      const res = await request(app).get(`/api/organizations/${org}/360`).set(bearer(orgStaff));
      expect(res.status).toBe(200);
      expect(res.body.organization.id).toBe(org);
      expect(res.body.locations.length).toBeGreaterThanOrEqual(1);
      expect(res.body.orders.orders_30d).toBe(1);
      expect(res.body.orders.gmv_30d_minor).toBe(10000);
      expect(res.body.orders.open).toHaveProperty("pos_orders");
      expect(res.body).toHaveProperty("entitlements");
      expect(res.body).toHaveProperty("recent_audit");
    });
    it("404s an unknown organization and 400s a malformed id", async () => {
      expect((await request(app).get("/api/organizations/00000000-0000-0000-0000-0000000000cc/360").set(bearer(sa))).status).toBe(404);
      expect((await request(app).get("/api/organizations/not-a-uuid/360").set(bearer(sa))).status).toBe(400);
    });
    it("changes the plan, shows entitlements and records the change", async () => {
      const none = await request(app).get(`/api/organizations/${org}/entitlements`).set(bearer(orgStaff));
      expect(none.status).toBe(200);
      expect(none.body.entitlements.subscribed).toBe(false);
      const set = await request(app).post(`/api/organizations/${org}/subscription`).set(bearer(orgStaff)).send({ plan_code: `mk_plan_a_${t}`, reason: "Sold at demo" });
      expect(set.status).toBe(200);
      expect(set.body.plan_code).toBe(`mk_plan_a_${t}`);
      const ent = await request(app).get(`/api/organizations/${org}/entitlements`).set(bearer(orgStaff));
      expect(ent.body.entitlements.subscribed).toBe(true);
      expect(ent.body.entitlements.plan_code).toBe(`mk_plan_a_${t}`);
      expect(ent.body.usage).toHaveProperty("active_locations");
      const same = await request(app).post(`/api/organizations/${org}/subscription`).set(bearer(sa)).send({ plan_code: `mk_plan_a_${t}`, reason: "same again" });
      expect(same.body.changed).toBe(false);
      const audit = await query("SELECT actor_user_id FROM audit_logs WHERE action = 'master.plan_changed' AND organization_id = $1;", [org]);
      expect(audit.rows[0].actor_user_id).toBe(orgStaff.id);
    });
    it("refuses an unpublished plan (400) and a plan whose limits the org already exceeds (409/400)", async () => {
      const bad = await request(app).post(`/api/organizations/${org}/subscription`).set(bearer(sa)).send({ plan_code: "ghost_plan", reason: "try" });
      expect(bad.status).toBe(400);
      expect(bad.body.errorCode).toBe("master_bad_plan");
      await query(`INSERT INTO locations (organization_id, name, code, kind, status, timezone) VALUES ($1, 'Extra', $2, 'restaurant', 'active', 'Asia/Kolkata');`, [org, `X${t}`.slice(0, 10)]).catch(() => undefined);
      const over = await request(app).post(`/api/organizations/${org}/subscription`).set(bearer(sa)).send({ plan_code: `mk_plan_small_${t}`, reason: "downgrade" });
      expect([400, 409]).toContain(over.status);
      expect(over.body.errorCode).toBe("master_plan_limit");
      expect((await request(app).post(`/api/organizations/${org}/subscription`).set(bearer(sa)).send({ plan_code: `mk_plan_a_${t}` })).status).toBe(400);
    });
    it("404s entitlements for an unknown organization", async () => {
      expect((await request(app).get("/api/organizations/00000000-0000-0000-0000-0000000000dd/entitlements").set(bearer(sa))).status).toBe(404);
    });
  });

  // ------------------------------------------------------------- invitations
  describe("invitations", () => {
    let org: string;
    let invId: string;
    const email = () => `invitee-${t}@test.local`;
    beforeAll(async () => {
      org = await createOrg({ status: "Active" });
      orgIds.push(org);
    });
    it("creates an invitation without ever returning the token", async () => {
      const res = await request(app).post("/api/invitations").set(bearer(orgStaff)).send({ organization_id: org, email: email().toUpperCase(), role_slug: "org_admin" });
      expect(res.status).toBe(201);
      invId = res.body.invitation.invitation_id;
      expect(res.body.invitation.status).toBe("pending");
      expect(res.body.invitation.email).toBe(email());
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
      const again = await request(app).post("/api/invitations").set(bearer(orgStaff)).send({ organization_id: org, email: email(), role_slug: "org_admin" });
      expect(again.body.invitation.invitation_id).toBe(invId); // idempotent for a pending invitation
    });
    it("lists with filters and pagination, no token in rows", async () => {
      const res = await request(app).get("/api/invitations").query({ org, status: "pending", page: 1, limit: 5 }).set(bearer(orgStaff));
      expect(res.status).toBe(200);
      expect(res.body.invitations.map((i: { id: string }) => i.id)).toContain(invId);
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 5, total: 1 });
      expect(res.body.invitations[0].role_slug).toBe("org_admin");
      expect(JSON.stringify(res.body)).not.toMatch(/"token"/);
      expect((await request(app).get("/api/invitations").query({ status: "bogus" }).set(bearer(sa))).status).toBe(400);
      expect((await request(app).get("/api/invitations").query({ limit: 500 }).set(bearer(sa))).status).toBe(400);
    });
    it("resend is throttled for 60 seconds, then works; revoke kills it and is idempotent", async () => {
      const tooSoon = await request(app).post(`/api/invitations/${invId}/resend`).set(bearer(orgStaff));
      expect(tooSoon.status).toBe(429);
      expect(tooSoon.body.errorCode).toBe("invitation_too_soon");
      await query("UPDATE org_invitations SET last_sent_at = now() - interval '5 minutes' WHERE id = $1;", [invId]);
      const ok = await request(app).post(`/api/invitations/${invId}/resend`).set(bearer(orgStaff));
      expect(ok.status).toBe(200);
      expect(ok.body.invitation.send_count).toBe(2);
      expect(JSON.stringify(ok.body)).not.toMatch(/"token"/);
      const rev = await request(app).post(`/api/invitations/${invId}/revoke`).set(bearer(orgStaff)).send({ reason: "Wrong person" });
      expect(rev.status).toBe(200);
      expect(rev.body.invitation.status).toBe("revoked");
      expect((await request(app).post(`/api/invitations/${invId}/revoke`).set(bearer(orgStaff)).send({})).body.invitation.changed).toBe(false);
      const after = await request(app).post(`/api/invitations/${invId}/resend`).set(bearer(orgStaff));
      expect(after.status).toBe(409);
      expect(after.body.errorCode).toBe("invitation_not_pending");
    });
    it("re-inviting a revoked email reopens it with a new token", async () => {
      const res = await request(app).post("/api/invitations").set(bearer(sa)).send({ organization_id: org, email: email(), role_slug: "org_admin" });
      expect(res.status).toBe(201);
      expect(res.body.invitation.status).toBe("pending");
    });
    it("validates the payload and the references", async () => {
      expect((await request(app).post("/api/invitations").set(bearer(sa)).send({ organization_id: org, email: "nope", role_slug: "org_admin" })).status).toBe(400);
      expect((await request(app).post("/api/invitations").set(bearer(sa)).send({ organization_id: org, email: "a@test.local", role_slug: "No Such!" })).status).toBe(400);
      const role = await request(app).post("/api/invitations").set(bearer(sa)).send({ organization_id: org, email: "b@test.local", role_slug: "no_such_role" });
      expect(role.status).toBe(400);
      expect(role.body.errorCode).toBe("master_bad_request");
      const nf = await request(app).post("/api/invitations").set(bearer(sa)).send({ organization_id: "00000000-0000-0000-0000-0000000000ee", email: "c@test.local", role_slug: "org_admin" });
      expect(nf.status).toBe(404);
      expect((await request(app).post(`/api/invitations/${"00000000-0000-0000-0000-0000000000ff"}/revoke`).set(bearer(sa)).send({})).status).toBe(404);
      expect((await request(app).post(`/api/invitations/${"00000000-0000-0000-0000-0000000000ff"}/resend`).set(bearer(sa))).status).toBe(404);
    });
  });
});
