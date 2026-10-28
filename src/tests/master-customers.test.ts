/**
 * Customers in Master: logins that are not partner staff, riders or platform staff, masked on the server, with test
 * accounts (test email domains) counted apart.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, tag } from "./helpers/master-kit";

async function login(email: string | null, phone: string | null = null): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, phone, email_confirmed_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, $2, now()) RETURNING id;`,
    [email, phone]
  );
  return r.rows[0].id;
}

describe("Master: customers", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  let sa: TestStaff;
  let viewer: TestStaff;
  let realEmail: string;
  let realId: string;

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin" });
    viewer = await staffWith({ feat_customers: ["view_customers"] }, roleKeys);
    staffIds.push(sa.id, viewer.id);
    realEmail = `priya${tag()}@gmail.com`;
    realId = await login(realEmail, `9198${String(Date.now()).slice(-8)}`);
    staffIds.push(realId, await login(`zz${tag()}@example.test`));
  });
  afterAll(async () => {
    await cleanup({ staffIds, roleKeys });
  });

  it("needs the customers permission", async () => {
    const none = await staffWith({ feat_orders: ["view_orders"] }, roleKeys);
    staffIds.push(none.id);
    expect((await request(app).get("/api/customers").set(bearer(none))).status).toBe(403);
  });

  it("counts customers and never sends a full email or phone", async () => {
    const res = await request(app).get("/api/customers").query({ q: realEmail.slice(0, 9) }).set(bearer(viewer));
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBeGreaterThanOrEqual(2);
    expect(res.body.summary.test).toBeGreaterThanOrEqual(1);
    const row = res.body.customers.find((c: { id: string }) => c.id === realId);
    expect(row.email_masked).toMatch(/^pr\*\*\*@gmail\.com$/);
    expect(row.phone_masked).toMatch(/^••••\d{4}$/);
    expect(JSON.stringify(res.body)).not.toContain(realEmail);
  });

  it("platform staff and test accounts are left out of the default (real) list", async () => {
    const res = await request(app).get("/api/customers").query({ limit: 100 }).set(bearer(viewer));
    const ids = res.body.customers.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(sa.id);
    expect(res.body.customers.every((c: { is_test: boolean }) => c.is_test === false)).toBe(true);
    const tests = await request(app).get("/api/customers").query({ accounts: "test", limit: 100 }).set(bearer(viewer));
    expect(tests.body.customers.every((c: { is_test: boolean }) => c.is_test === true)).toBe(true);
  });
});
