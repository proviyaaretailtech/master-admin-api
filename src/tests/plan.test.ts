import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { signJwtToken } from "../utils/jwt";

describe("Commercial Plans API & Access Control Integration Tests", () => {
  let superAdminToken: string;
  let restrictedUserToken: string;
  let createdPlanId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    // 1. Ensure Super Admin role exists
    const saRole = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
       VALUES ('Super Administrator', 'super_admin', 'All organizations', 'Root Super Admin', true, true, '')
       ON CONFLICT (key) DO UPDATE SET is_system = true RETURNING id;`
    );
    const saRoleId = saRole.rows[0].id;

    // Use or create dedicated super admin user without deleting it in afterAll
    const saUser = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('Super', 'Admin', 'superadmin@onlatur.com', '+15550003344', 'hash', 'Active', $1)
       ON CONFLICT (email) DO UPDATE SET role_id = $1 RETURNING id, email;`,
      [saRoleId]
    );
    superAdminToken = signJwtToken({ userId: saUser.rows[0].id, email: saUser.rows[0].email });

    // Ensure restricted role exists with NO commercial permissions
    const restrictedRole = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
       VALUES ('Plan Restricted Staff', 'plan_test_restricted_role', 'One organization', 'No commercial plans access', true, false, '')
       ON CONFLICT (key) DO UPDATE SET permissions = '' RETURNING id;`
    );
    const restrictedRoleId = restrictedRole.rows[0].id;

    // Create or update restricted user
    const resUser = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('Plan Restricted', 'User', 'plan-restricted-test@onlatur.com', '+15550002222', 'hashed_pass', 'Active', $1)
       ON CONFLICT (email) DO UPDATE SET role_id = $1 RETURNING id, email;`,
      [restrictedRoleId]
    );
    restrictedUserToken = signJwtToken({
      userId: resUser.rows[0].id,
      email: resUser.rows[0].email,
    });

    // Clean up test plans and modules
    await query("DELETE FROM commercial_plans WHERE plan_code LIKE 'test_%';");
    await query("DELETE FROM platform_modules WHERE key IN ('MODTST', 'MODLTR');");
  });

  afterAll(async () => {
    // Cleanup test plans, modules, and restricted test user
    await query("DELETE FROM commercial_plans WHERE plan_code LIKE 'test_%';");
    await query("DELETE FROM platform_modules WHERE key IN ('MODTST', 'MODLTR');");
    await query("DELETE FROM users WHERE email = 'plan-restricted-test@onlatur.com';");
    await query("DELETE FROM security_roles WHERE key = 'plan_test_restricted_role';");
  });

  describe("Access Control & Permission Gating", () => {
    it("rejects unauthorized access when token is missing (401 Unauthorized)", async () => {
      const res = await request(app).get("/api/commercials/plans");
      expect(res.status).toBe(401);
    });

    it("rejects user without view_plans permission with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/commercials/plans")
        .set("Authorization", `Bearer ${restrictedUserToken}`);

      expect(res.status).toBe(403);
    });

    it("rejects user without view_plans permission on modules with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/commercials/modules")
        .set("Authorization", `Bearer ${restrictedUserToken}`);

      expect(res.status).toBe(403);
    });

    it("rejects user without manage_modules permission on creating module with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/commercials/modules")
        .set("Authorization", `Bearer ${restrictedUserToken}`)
        .send({
          key: "MODUNAUTH",
          name: "Unauthorized Module",
        });

      expect(res.status).toBe(403);
    });
  });

  describe("CRUD Operations on /api/commercials/plans", () => {
    it("POST /api/commercials/plans - creates a new commercial plan with JSONB modules array", async () => {
      const payload = {
        name: "Test Growth Plan",
        plan_code: "test_growth_plan",
        version: "v1.0",
        version_type: "Draft",
        status: "Draft",
        price: 4999,
        currency: "INR",
        cadence: "Monthly",
        tax_note: "+18% GST Applicable",
        trial_days: 14,
        locations_limit: 3,
        users_limit: 10,
        is_unlimited_locations: false,
        is_unlimited_users: false,
        modules: ["MODORG", "MODACC", "MODCOM"],
      };

      const res = await request(app)
        .post("/api/commercials/plans")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.plan).toBeDefined();
      expect(res.body.plan.name).toBe("Test Growth Plan");
      expect(res.body.plan.plan_code).toBe("test_growth_plan");
      expect(res.body.plan.price).toBe(4999);
      expect(res.body.plan.modules).toEqual(["MODORG", "MODACC", "MODCOM"]);

      createdPlanId = res.body.plan.id;
    });

    it("GET /api/commercials/plans - lists plans with active assignment counts", async () => {
      const res = await request(app)
        .get("/api/commercials/plans")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.plans)).toBe(true);
      const found = res.body.plans.find((p: any) => p.id === createdPlanId);
      expect(found).toBeDefined();
      expect(found.assignments_count).toBe(0);
    });

    it("GET /api/commercials/plans/:id - retrieves a single commercial plan", async () => {
      const res = await request(app)
        .get(`/api/commercials/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.plan.id).toBe(createdPlanId);
      expect(res.body.plan.plan_code).toBe("test_growth_plan");
    });

    it("PUT /api/commercials/plans/:id - updates plan details and pricing", async () => {
      const res = await request(app)
        .put(`/api/commercials/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          price: 5499,
          locations_limit: 5,
          modules: ["MODORG", "MODACC", "MODCOM", "MODINV"],
        });

      expect(res.status).toBe(200);
      expect(res.body.plan.price).toBe(5499);
      expect(res.body.plan.locations_limit).toBe(5);
      expect(res.body.plan.modules).toContain("MODINV");
    });

    it("POST /api/commercials/plans/:id/publish - marks plan as Published and Active", async () => {
      const res = await request(app)
        .post(`/api/commercials/plans/${createdPlanId}/publish`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.plan.status).toBe("Published");
      expect(res.body.plan.version_type).toBe("Active");
    });

    it("POST /api/commercials/plans/:id/duplicate - clones plan into a draft copy", async () => {
      const res = await request(app)
        .post(`/api/commercials/plans/${createdPlanId}/duplicate`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.plan.name).toContain("(Copy)");
      expect(res.body.plan.status).toBe("Draft");
      expect(res.body.plan.price).toBe(5499);

      // Clean up the clone
      await query("DELETE FROM commercial_plans WHERE id = $1;", [res.body.plan.id]);
    });

    it("DELETE /api/commercials/plans/:id - deletes the test plan", async () => {
      const res = await request(app)
        .delete(`/api/commercials/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdPlanId);

      // Verify it's gone
      const verifyRes = await request(app)
        .get(`/api/commercials/plans/${createdPlanId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(verifyRes.status).toBe(404);
    });
  });

  describe("Platform Modules CRUD & Plan Immutability (Point 5 Verification)", () => {
    it("POST /api/commercials/modules - creates a platform module", async () => {
      const res = await request(app)
        .post("/api/commercials/modules")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          key: "MODTST",
          name: "Test Verification Module",
          category: "Testing",
        });

      expect(res.status).toBe(201);
      expect(res.body.module).toBeDefined();
      expect(res.body.module.key).toBe("MODTST");
    });

    it("ensures newly created module is NOT included in plans created beforehand without it", async () => {
      // 1. Create a plan with only MODTST
      const planRes = await request(app)
        .post("/api/commercials/plans")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Immutability Plan",
          plan_code: "test_immutability_plan",
          price: 1999,
          modules: ["MODTST"],
        });

      expect(planRes.status).toBe(201);
      const planId = planRes.body.plan.id;

      // 2. Create another module afterwards
      const newModRes = await request(app)
        .post("/api/commercials/modules")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          key: "MODLTR",
          name: "Later Module",
          category: "Future",
        });

      expect(newModRes.status).toBe(201);

      // 3. Fetch the previously created plan
      const getPlanRes = await request(app)
        .get(`/api/commercials/plans/${planId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(getPlanRes.status).toBe(200);
      // Verify MODLTR is NOT in the plan's modules array!
      expect(getPlanRes.body.plan.modules).toEqual(["MODTST"]);
      expect(getPlanRes.body.plan.modules).not.toContain("MODLTR");

      // Cleanup
      await query("DELETE FROM commercial_plans WHERE id = $1;", [planId]);
      await query("DELETE FROM platform_modules WHERE key IN ('MODTST', 'MODLTR');");
    });

    it("sanitizes legacy 'ALL' into explicit module keys array when saving or querying", async () => {
      const planRes = await request(app)
        .post("/api/commercials/plans")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "All Sanitization Plan",
          plan_code: "test_all_sanitization_plan",
          price: 999,
          modules: ["ALL"],
        });

      expect(planRes.status).toBe(201);
      const planId = planRes.body.plan.id;

      // Ensure modules array does NOT contain 'ALL'
      expect(planRes.body.plan.modules).not.toContain("ALL");
      expect(Array.isArray(planRes.body.plan.modules)).toBe(true);

      const getPlanRes = await request(app)
        .get(`/api/commercials/plans/${planId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(getPlanRes.status).toBe(200);
      expect(getPlanRes.body.plan.modules).not.toContain("ALL");

      // Cleanup
      await query("DELETE FROM commercial_plans WHERE id = $1;", [planId]);
    });
  });
});
