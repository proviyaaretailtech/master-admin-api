import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { createStaff, createOrg, cleanup } from "./helpers/testkit";

describe("Organization Locations API Integration Tests", () => {
  let authToken: string;
  let testOrgId: string;
  let createdLocationId: string;
  const staffIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    const sa = await createStaff({ roleKey: "super_admin" });
    staffIds.push(sa.id);
    authToken = sa.token;

    // A dedicated organization to associate locations with (comes with a default MAIN location)
    testOrgId = await createOrg({ name: "Test Org For Locations" });
  });

  afterAll(async () => {
    // Deleting the organization cascades to its locations
    await cleanup({ orgIds: [testOrgId], staffIds });
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
