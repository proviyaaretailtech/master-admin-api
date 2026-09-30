import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { signJwtToken } from "../utils/jwt";

describe("Commercial Add-ons API & Access Control Integration Tests", () => {
  let superAdminToken: string;
  let restrictedUserToken: string;
  let createdAddonId: string;
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

    // 2. Ensure restricted role exists with NO commercial add-on permissions
    const restrictedRole = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
       VALUES ('Addon Restricted Staff', 'addon_test_restricted_role', 'One organization', 'No commercial addons access', true, false, '')
       ON CONFLICT (key) DO UPDATE SET permissions = '' RETURNING id;`
    );
    const restrictedRoleId = restrictedRole.rows[0].id;

    // Create or update restricted user
    const resUser = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('Addon Restricted', 'User', 'addon-restricted-test@onlatur.com', '+15550005577', 'hashed_pass', 'Active', $1)
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
       VALUES ('Addon Test Org', 'Retail', 'Active', 'addon-test@org.com', '+15554443333')
       ON CONFLICT (email) DO UPDATE SET business_name = 'Addon Test Org' RETURNING id;`
    );
    testOrgId = orgRes.rows[0].id;

    const planRes = await query<{ id: string }>(
      `INSERT INTO commercial_plans (plan_code, name, price, modules)
       VALUES ('test_addon_compatible_plan', 'Addon Test Plan', 1999, '[]'::jsonb)
       ON CONFLICT (plan_code) DO UPDATE SET name = 'Addon Test Plan' RETURNING id;`
    );
    testPlanId = planRes.rows[0].id;

    // Clean up any test addons from previous runs
    await query("DELETE FROM commercial_addons WHERE addon_code LIKE 'ad_test_%';");
  });

  afterAll(async () => {
    // Cleanup
    await query("DELETE FROM subscriptions WHERE organization_id = $1;", [testOrgId]);
    await query("DELETE FROM commercial_addons WHERE addon_code LIKE 'ad_test_%';");
    await query("DELETE FROM commercial_plans WHERE plan_code = 'test_addon_compatible_plan';");
    await query("DELETE FROM organizations WHERE id = $1;", [testOrgId]);
    await query("DELETE FROM users WHERE email = 'addon-restricted-test@onlatur.com';");
    await query("DELETE FROM security_roles WHERE key = 'addon_test_restricted_role';");
  });

  describe("Access Control & Permission Gating", () => {
    it("rejects unauthorized access when token is missing (401 Unauthorized)", async () => {
      const res = await request(app).get("/api/commercials/add-ons");
      expect(res.status).toBe(401);
    });

    it("rejects user without view_addons permission with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/commercials/add-ons")
        .set("Authorization", `Bearer ${restrictedUserToken}`);

      expect(res.status).toBe(403);
    });

    it("rejects user without create_addon permission with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/commercials/add-ons")
        .set("Authorization", `Bearer ${restrictedUserToken}`)
        .send({
          name: "Unauthorized Addon",
          addon_code: "ad_test_unauth",
          category: "Infrastructure",
          price: 999,
        });

      expect(res.status).toBe(403);
    });

    it("allows Super Administrator to access add-on endpoints regardless of permissions string", async () => {
      const res = await request(app)
        .get("/api/commercials/add-ons")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("retrieved successfully");
      expect(Array.isArray(res.body.addons)).toBe(true);
    });
  });

  describe("Add-on CRUD & Dynamic Assignments", () => {
    it("creates a new commercial add-on in Draft status", async () => {
      const res = await request(app)
        .post("/api/commercials/add-ons")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Test Location Addon",
          addon_code: "ad_test_loc_01",
          description: "Allows adding extra locations",
          category: "Infrastructure",
          status: "Draft",
          version: "v1.0",
          price: 999,
          currency: "INR",
          cadence: "Monthly",
          unit_label: "location",
          pricing_subtitle: "Per site monthly billing",
          min_quantity: 1,
          max_quantity: 5,
          compatible_plans: ["test_addon_compatible_plan"],
        });

      expect(res.status).toBe(201);
      expect(res.body.addon).toBeDefined();
      expect(res.body.addon.addon_code).toBe("ad_test_loc_01");
      expect(res.body.addon.status).toBe("Draft");
      expect(res.body.addon.price).toBe(999);
      expect(res.body.addon.min_quantity).toBe(1);
      expect(res.body.addon.max_quantity).toBe(5);
      expect(res.body.addon.active_units_count).toBe(0);
      expect(res.body.addon.assigned_count).toBe(0);

      createdAddonId = res.body.addon.id;
    });

    it("prevents duplicate addon_code creation (400 Bad Request)", async () => {
      const res = await request(app)
        .post("/api/commercials/add-ons")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Duplicate Addon",
          addon_code: "ad_test_loc_01",
          category: "Infrastructure",
          price: 500,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it("retrieves add-on by ID", async () => {
      const res = await request(app)
        .get(`/api/commercials/add-ons/${createdAddonId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.addon.id).toBe(createdAddonId);
      expect(res.body.addon.name).toBe("Test Location Addon");
    });

    it("retrieves categories list", async () => {
      const res = await request(app)
        .get("/api/commercials/add-ons/categories")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.categories).toContain("Infrastructure");
    });

    it("updates add-on metadata and pricing", async () => {
      const res = await request(app)
        .put(`/api/commercials/add-ons/${createdAddonId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Updated Location Addon",
          price: 1500,
          max_quantity: 8,
          pricing_subtitle: "Updated billing note",
        });

      expect(res.status).toBe(200);
      expect(res.body.addon.name).toBe("Updated Location Addon");
      expect(res.body.addon.price).toBe(1500);
      expect(res.body.addon.max_quantity).toBe(8);
      expect(res.body.addon.pricing_subtitle).toBe("Updated billing note");
    });

    it("publishes the add-on", async () => {
      const res = await request(app)
        .post(`/api/commercials/add-ons/${createdAddonId}/publish`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.addon.status).toBe("Published");
    });

    it("dynamically reflects assigned organizations and active units from subscriptions.addons", async () => {
      // Create subscription with add-on allocation: 3 units of ad_test_loc_01
      await query(
        `INSERT INTO subscriptions (organization_id, plan_id, status, billing_cadence, addons)
         VALUES ($1, $2, 'Active', 'Monthly', $3::jsonb);`,
        [testOrgId, testPlanId, JSON.stringify([{ addon_code: "ad_test_loc_01", quantity: 3 }])]
      );

      const res = await request(app)
        .get(`/api/commercials/add-ons/${createdAddonId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.addon.assigned_count).toBe(1);
      expect(res.body.addon.active_units_count).toBe(3);
    });

    it("prevents deleting an add-on with active client subscriptions", async () => {
      const res = await request(app)
        .delete(`/api/commercials/add-ons/${createdAddonId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot delete/i);
    });

    it("retires the add-on successfully", async () => {
      const res = await request(app)
        .post(`/api/commercials/add-ons/${createdAddonId}/retire`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.addon.status).toBe("Retired");
    });

    it("allows deleting an add-on once active subscription assignments are cleared", async () => {
      // Clear subscription
      await query("DELETE FROM subscriptions WHERE organization_id = $1;", [testOrgId]);

      const res = await request(app)
        .delete(`/api/commercials/add-ons/${createdAddonId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted successfully/i);
    });
  });
});
