/** Role sets per store type (0632) and test logins (0633) from Master. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, tag } from "./helpers/master-kit";

describe("Master: role sets and test logins", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  const orgIds: string[] = [];
  let sa: TestStaff;
  let viewer: TestStaff;
  let ops: TestStaff; // may manage sets and make test logins by permission, but is not super admin
  let org: string;

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin" });
    viewer = await staffWith({ feat_role_sets: ["view_role_sets"] }, roleKeys);
    ops = await staffWith({ feat_role_sets: ["view_role_sets", "manage_role_sets", "create_test_login"] }, roleKeys);
    staffIds.push(sa.id, viewer.id, ops.id);
    org = (await query<{ id: string }>(`INSERT INTO organizations (name, slug, type) VALUES ($1, $2, 'franchise') RETURNING id;`, [`Roles Org ${tag()}`, `roles-${tag()}`])).rows[0].id;
    orgIds.push(org);
  });
  afterAll(async () => {
    const tests = await query<{ user_id: string }>(`SELECT user_id FROM test_logins WHERE organization_id = $1;`, [org]);
    staffIds.push(...tests.rows.map((t) => t.user_id));
    await query(`DELETE FROM platform_role_sets WHERE store_type = 'service';`).catch(() => undefined);
    await cleanup({ orgIds, staffIds, roleKeys });
  });

  it("lists every role and the (empty) sets; a viewer cannot change a set", async () => {
    const res = await request(app).get("/api/role-sets").set(bearer(viewer));
    expect(res.status).toBe(200);
    expect(res.body.store_types).toEqual(["restaurant", "store", "service", "logistic"]);
    expect(res.body.roles.map((r: { slug: string }) => r.slug)).not.toContain("org_owner");
    expect((await request(app).put("/api/role-sets/service/biller").set(bearer(viewer))).status).toBe(403);
  });

  it("applying an empty set is refused; add roles, apply, and the business shows them", async () => {
    const empty = await request(app).post(`/api/organizations/${org}/staff-roles/apply`).set(bearer(ops)).send({ store_type: "service" });
    expect(empty.status).toBe(400);
    expect((await request(app).put("/api/role-sets/service/biller").set(bearer(ops))).status).toBe(200);
    expect((await request(app).put("/api/role-sets/service/org_owner").set(bearer(ops))).status).toBe(400);
    const applied = await request(app).post(`/api/organizations/${org}/staff-roles/apply`).set(bearer(ops)).send({ store_type: "service" });
    expect(applied.status).toBe(200);
    expect(applied.body.result.roles_added).toBe(1);
    const roles = await request(app).get(`/api/organizations/${org}/staff-roles`).set(bearer(viewer));
    expect(roles.body.grants.map((g: { role_slug: string }) => g.role_slug)).toEqual(["biller"]);
    expect(roles.body.test_logins_allowed).toBe(true);
  });

  it("test login: only a super admin, returns the password once, and the login shows as a test member", async () => {
    const denied = await request(app).post(`/api/organizations/${org}/test-login`).set(bearer(ops)).send({});
    expect(denied.status).toBe(403);
    const made = await request(app).post(`/api/organizations/${org}/test-login`).set(bearer(sa)).send({ role: "biller" });
    expect(made.status).toBe(200);
    expect(made.body.result.email).toMatch(/^test\+roles-.+@proviyaa\.test$/);
    expect(made.body.result.password.length).toBeGreaterThanOrEqual(10);
    const roles = await request(app).get(`/api/organizations/${org}/staff-roles`).set(bearer(viewer));
    const member = roles.body.members.find((m: { is_test: boolean }) => m.is_test);
    expect(member).toMatchObject({ role_slug: "biller", is_test: true });
    expect(JSON.stringify(roles.body)).not.toContain(made.body.result.password);
    const notGranted = await request(app).post(`/api/organizations/${org}/test-login`).set(bearer(sa)).send({ role: "kitchen" });
    expect(notGranted.status).toBe(400);
    const left = await query(`SELECT count(*)::int AS n FROM auth.users WHERE email LIKE 'test+roles-%' AND id NOT IN (SELECT user_id FROM test_logins);`);
    expect(left.rows[0].n).toBe(0);
  });
});
