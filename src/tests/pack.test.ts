import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { ensureRole, createStaff, createOrg, cleanup } from "./helpers/testkit";

describe("Commercial Feature Packs API & Access Control Integration Tests", () => {
  let superAdminToken: string;
  let restrictedUserToken: string;
  let createdPackId: string;
  let testOrgId: string;
  let testPlanId: string;
  const staffIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    await ensureRole({ key: "pack_test_restricted_role", name: "Pack Restricted Staff", permissions: "" });
    const sa = await createStaff({ roleKey: "super_admin" });
    const restricted = await createStaff({ roleKey: "pack_test_restricted_role" });
    staffIds.push(sa.id, restricted.id);
    superAdminToken = sa.token;
    restrictedUserToken = restricted.token;

    // Test organization and commercial plan for subscription tests
    testOrgId = await createOrg({ name: "Packs Test Org" });

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
    await query("DELETE FROM subscriptions WHERE organization_id = $1;", [testOrgId]);
    await query("DELETE FROM commercial_packs WHERE pack_code LIKE 'pk_test_%';");
    await query("DELETE FROM commercial_plans WHERE plan_code = 'test_pack_compatible_plan';");
    await cleanup({ orgIds: [testOrgId], staffIds, roleKeys: ["pack_test_restricted_role"] });
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
