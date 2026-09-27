import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { signJwtToken } from "../utils/jwt";

describe("Organization Locations API Integration Tests", () => {
  let authToken: string;
  let testUserId: string;
  let testOrgId: string;
  let createdLocationId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    // Ensure super_admin role exists
    const saRole = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
       VALUES ('Super Admin', 'super_admin', 'All organizations', 'Root Super Admin', true, true, '')
       ON CONFLICT (key) DO UPDATE SET is_system = true RETURNING id;`
    );
    const saRoleId = saRole.rows[0].id;

    // 1. Get or create test user for auth token
    const userRes = await query<{ id: string; email: string }>(
      "SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1;"
    );

    if (userRes.rows.length > 0) {
      testUserId = userRes.rows[0].id;
      await query("UPDATE users SET role_id = $1 WHERE id = $2;", [saRoleId, testUserId]);
      authToken = signJwtToken({ userId: testUserId, email: userRes.rows[0].email });
    } else {
      const newUser = await query<{ id: string; email: string }>(
        `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
         VALUES ('Test', 'Admin', 'location-tester@onlatur.com', '+15551119999', 'hashed_pass', 'Active', $1)
         RETURNING id, email;`,
        [saRoleId]
      );
      testUserId = newUser.rows[0].id;
      authToken = signJwtToken({ userId: testUserId, email: newUser.rows[0].email });
    }

    // 2. Ensure we have an active test organization to associate locations with
    const orgRes = await query<{ id: string }>(
      "SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1;"
    );

    if (orgRes.rows.length > 0) {
      testOrgId = orgRes.rows[0].id;
    } else {
      const newOrg = await query<{ id: string }>(
        `INSERT INTO organizations (business_name, domain, status, email, phone_number)
         VALUES ('Test Org For Locations', 'Test Domain', 'Active', 'test-loc@org.com', '+15559990001')
         RETURNING id;`
      );
      testOrgId = newOrg.rows[0].id;
    }
  });

  afterAll(async () => {
    // Cleanup any created test location
    if (createdLocationId && testOrgId) {
      await query("DELETE FROM org_locations WHERE id = $1;", [createdLocationId]);
    }
  });

  describe("Validation & Error Cases", () => {
    it("should return 401 when accessing locations without auth token", async () => {
      const res = await request(app).get(`/api/organizations/${testOrgId}/locations`);
      expect(res.status).toBe(401);
      expect(res.body.message).toContain("token is missing");
    });

    it("should return 400 when creating location with invalid/missing name", async () => {
      const res = await request(app)
        .post(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          area: "Indiranagar",
          code: "TEST-01",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("should return 404 when querying locations for a nonexistent organization UUID", async () => {
      const fakeUuid = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .get(`/api/organizations/${fakeUuid}/locations`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain("does not exist");
    });
  });

  describe("CRUD Operations on /api/organizations/:org_id/locations", () => {
    it("POST /api/organizations/:org_id/locations - creates a new location", async () => {
      const newLocationData = {
        name: "Indiranagar Flagship Cafe",
        area: "100ft Road, Indiranagar, Bengaluru",
        code: "ANN-FLAGSHIP",
        type: "Restaurant",
        status: "Active",
        timeZone: "Asia/Kolkata",
        currency: "INR (₹)",
      };

      const res = await request(app)
        .post(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${authToken}`)
        .send(newLocationData);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("message", "Location created successfully");
      expect(res.body).toHaveProperty("location");
      expect(res.body.location.name).toBe("Indiranagar Flagship Cafe");
      expect(res.body.location.code).toBe("ANN-FLAGSHIP");
      expect(res.body.location.org_id).toBe(testOrgId);
      expect(res.body.location.time_zone).toBe("Asia/Kolkata");

      createdLocationId = res.body.location.id;
    });

    it("GET /api/organizations/:org_id/locations - lists locations for organization", async () => {
      const res = await request(app)
        .get(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("locations");
      expect(res.body).toHaveProperty("organization");
      expect(res.body).toHaveProperty("pagination");
      expect(Array.isArray(res.body.locations)).toBe(true);
      expect(res.body.locations.length).toBeGreaterThan(0);
    });

    it("GET /api/organizations/:org_id/locations - supports search query filter", async () => {
      const res = await request(app)
        .get(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${authToken}`)
        .query({ search: "Flagship" });

      expect(res.status).toBe(200);
      expect(res.body.locations.some((l: any) => l.name.includes("Flagship"))).toBe(true);
    });

    it("GET /api/organizations/:org_id/locations/:id - fetches location by ID", async () => {
      const res = await request(app)
        .get(`/api/organizations/${testOrgId}/locations/${createdLocationId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("location");
      expect(res.body.location.id).toBe(createdLocationId);
      expect(res.body.location.name).toBe("Indiranagar Flagship Cafe");
    });

    it("PATCH /api/organizations/:org_id/locations/:id - updates location", async () => {
      const res = await request(app)
        .patch(`/api/organizations/${testOrgId}/locations/${createdLocationId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Indiranagar Mega Outlet",
          status: "Pending",
        });

      expect(res.status).toBe(200);
      expect(res.body.location.name).toBe("Indiranagar Mega Outlet");
      expect(res.body.location.status).toBe("Pending");
    });

    it("DELETE /api/organizations/:org_id/locations/:id - deletes location", async () => {
      const deleteRes = await request(app)
        .delete(`/api/organizations/${testOrgId}/locations/${createdLocationId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toHaveProperty("message", "Location deleted successfully");

      // Verify subsequent get returns 404
      const getRes = await request(app)
        .get(`/api/organizations/${testOrgId}/locations/${createdLocationId}`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(getRes.status).toBe(404);

      createdLocationId = ""; // mark as deleted
    });
  });
});

