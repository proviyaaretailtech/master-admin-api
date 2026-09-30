import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { signJwtToken } from "../utils/jwt";

describe("Commercial Feature Packs API & Access Control Integration Tests", () => {
  let superAdminToken: string;
  let restrictedUserToken: string;
  let createdPackId: string;
  let testOrgId: string;
  let testPlanId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    // 1. Ensure Super Admin role exists
    const saRole = await query<{ id: string; name: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
       VALUES ('Super Administrator', 'super_admin', 'All organizations', 'Root Super Admin', true, true, '')
       ON CONFLICT (key) DO UPDATE SET is_system = true RETURNING id, name;`
    );
    const saRoleId = saRole.rows[0].id;

    // Use or create dedicated super admin user
    const saUser = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('Super', 'Admin', 'superadmin@onlatur.com', '+15550003344', 'hash', 'Active', $1)
       ON CONFLICT (email) DO UPDATE SET role_id = $1 RETURNING id, email;`,
      [saRoleId]
    );
    superAdminToken = signJwtToken({ userId: saUser.rows[0].id, email: saUser.rows[0].email });

    // 2. Ensure restricted role exists with NO commercial pack permissions
    const restrictedRole = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
       VALUES ('Pack Restricted Staff', 'pack_test_restricted_role', 'One organization', 'No commercial packs access', true, false, '')
       ON CONFLICT (key) DO UPDATE SET permissions = '' RETURNING id;`
    );
    const restrictedRoleId = restrictedRole.rows[0].id;

    // Create or update restricted user
    const resUser = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('Pack Restricted', 'User', 'pack-restricted-test@onlatur.com', '+15550005566', 'hashed_pass', 'Active', $1)
       ON CONFLICT (email) DO UPDATE SET role_id = $1 RETURNING id, email;`,
      [restrictedRoleId]
    );
    restrictedUserToken = signJwtToken({
      userId: resUser.rows[0].id,
      email: resUser.rows[0].email,
    });

    // 3. Ensure test organization and commercial plan exist for subscription tests
    const orgRes = await query<{ id: string }>(
      `INSERT INTO organizations (business_name, domain, status, email, phone_number)
       VALUES ('Packs Test Org', 'Restaurant', 'Active', 'packs-test@org.com', '+15554443322')
       ON CONFLICT (email) DO UPDATE SET business_name = 'Packs Test Org' RETURNING id;`
    );
    testOrgId = orgRes.rows[0].id;

    const planRes = await query<{ id: string }>(
      `INSERT INTO commercial_plans (plan_code, name, price, modules)
       VALUES ('test_pack_compatible_plan', 'Pack Test Plan', 2999, '[]'::jsonb)
       ON CONFLICT (plan_code) DO UPDATE SET name = 'Pack Test Plan' RETURNING id;`
    );
    testPlanId = planRes.rows[0].id;

    // Clean up any test packs from previous runs
    await query("DELETE FROM commercial_packs WHERE pack_code LIKE 'pk_test_%';");
  });

  afterAll(async () => {
    // Cleanup
    await query("DELETE FROM subscriptions WHERE organization_id = $1;", [testOrgId]);
    await query("DELETE FROM commercial_packs WHERE pack_code LIKE 'pk_test_%';");
    await query("DELETE FROM commercial_plans WHERE plan_code = 'test_pack_compatible_plan';");
    await query("DELETE FROM organizations WHERE id = $1;", [testOrgId]);
    await query("DELETE FROM users WHERE email = 'pack-restricted-test@onlatur.com';");
    await query("DELETE FROM security_roles WHERE key = 'pack_test_restricted_role';");
  });

  describe("Access Control & Permission Gating", () => {
    it("rejects unauthorized access when token is missing (401 Unauthorized)", async () => {
      const res = await request(app).get("/api/commercials/packs");
      expect(res.status).toBe(401);
    });

    it("rejects user without view_packs permission with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/commercials/packs")
        .set("Authorization", `Bearer ${restrictedUserToken}`);

      expect(res.status).toBe(403);
    });

    it("rejects user without create_pack permission with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/commercials/packs")
        .set("Authorization", `Bearer ${restrictedUserToken}`)
        .send({
          name: "Unauthorized Pack",
          pack_code: "pk_test_unauth",
        });

      expect(res.status).toBe(403);
    });
  });

  describe("CRUD Operations on /api/commercials/packs", () => {
    it("POST /api/commercials/packs - creates a new commercial pack", async () => {
      const payload = {
        name: "Advanced Reporting Pack",
        pack_code: "pk_test_adv_reporting",
        description: "Custom SQL and scheduled PDF dashboards",
        status: "Draft",
        price: 1499,
        currency: "INR",
        cadence: "Monthly",
        effective_date: "2026-03-01T00:00:00Z",
        extended_limits: "Adds +5 custom metrics panels, unlimited scheduled reports",
        prerequisite_note: "Requires intelligence platform module ready state",
        included_feature_title: "Custom SQL, Scheduled PDF",
        included_feature_subtitle: "Up to 50 scheduled dashboards",
        compatible_plans: ["test_pack_compatible_plan", "Enterprise Suite"],
        required_modules: ["MODINT"],
      };

      const res = await request(app)
        .post("/api/commercials/packs")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.pack).toBeDefined();
      expect(res.body.pack.pack_code).toBe("pk_test_adv_reporting");
      expect(res.body.pack.price).toBe(1499);
      expect(res.body.pack.status).toBe("Draft");
      expect(res.body.pack.compatible_plans).toContain("test_pack_compatible_plan");
      expect(res.body.pack.assigned_count).toBe(0);

      createdPackId = res.body.pack.id;
    });

    it("GET /api/commercials/packs - lists packs with assigned_count and supports search filter", async () => {
      const res = await request(app)
        .get("/api/commercials/packs")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .query({ search: "Advanced Reporting" });

      expect(res.status).toBe(200);
      expect(res.body.packs).toBeDefined();
      expect(Array.isArray(res.body.packs)).toBe(true);
      expect(res.body.packs.some((p: any) => p.id === createdPackId)).toBe(true);
    });

    it("GET /api/commercials/packs/:id - fetches pack by ID", async () => {
      const res = await request(app)
        .get(`/api/commercials/packs/${createdPackId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pack.id).toBe(createdPackId);
      expect(res.body.pack.name).toBe("Advanced Reporting Pack");
    });

    it("PUT /api/commercials/packs/:id - updates pack configuration", async () => {
      const res = await request(app)
        .put(`/api/commercials/packs/${createdPackId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          price: 1999,
          extended_limits: "Updated extended limits description",
        });

      expect(res.status).toBe(200);
      expect(res.body.pack.price).toBe(1999);
      expect(res.body.pack.extended_limits).toBe("Updated extended limits description");
    });

    it("POST /api/commercials/packs/:id/publish - marks pack as Published", async () => {
      const res = await request(app)
        .post(`/api/commercials/packs/${createdPackId}/publish`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pack.status).toBe("Published");
    });

    it("evaluates real-time dynamic assigned_count from subscriptions.packs JSONB column", async () => {
      // Create subscription with this pack_code in packs array
      await query(
        `INSERT INTO subscriptions (organization_id, plan_id, status, packs)
         VALUES ($1, $2, 'Active', jsonb_build_array('pk_test_adv_reporting'))
         ON CONFLICT DO NOTHING;`,
        [testOrgId, testPlanId]
      );

      const res = await request(app)
        .get(`/api/commercials/packs/${createdPackId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pack.assigned_count).toBe(1);

      // Clean up subscription
      await query("DELETE FROM subscriptions WHERE organization_id = $1;", [testOrgId]);
    });

    it("POST /api/commercials/packs/:id/retire - marks pack as Retired", async () => {
      const res = await request(app)
        .post(`/api/commercials/packs/${createdPackId}/retire`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pack.status).toBe("Retired");
    });

    it("DELETE /api/commercials/packs/:id - deletes the test pack", async () => {
      const res = await request(app)
        .delete(`/api/commercials/packs/${createdPackId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdPackId);

      const verifyRes = await request(app)
        .get(`/api/commercials/packs/${createdPackId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(verifyRes.status).toBe(404);
    });
  });
});
