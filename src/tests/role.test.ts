import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { signJwtToken } from "../utils/jwt";

describe("Security Roles & Permissions API Integration Tests", () => {
  let authToken: string;
  let testUserId: string;
  let createdRoleId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    // Clean up any remnants from previous tests
    await query(
      "DELETE FROM security_roles WHERE key = 'super_admin_dup_key' OR key = 'test_compliance_officer';"
    );

    // Ensure super_admin role exists
    const saRole = await query<{ id: string; name: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
       VALUES ('Super Admin', 'super_admin', 'All organizations', 'Root Super Admin', true, true, '')
       ON CONFLICT (key) DO UPDATE SET is_system = true RETURNING id, name;`
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
         VALUES ('Test', 'Admin', 'role-tester@onlatur.com', '+15551112233', 'hashed_pass', 'Active', $1)
         RETURNING id, email;`,
        [saRoleId]
      );
      testUserId = newUser.rows[0].id;
      authToken = signJwtToken({ userId: testUserId, email: newUser.rows[0].email });
    }
  });

  afterAll(async () => {
    // Cleanup any created role
    if (createdRoleId) {
      await query("DELETE FROM security_roles WHERE id = $1;", [createdRoleId]);
    }
    await query(
      "DELETE FROM security_roles WHERE key = 'super_admin_dup_key' OR key = 'test_compliance_officer';"
    );
  });

  describe("Validation & Error Cases", () => {
    it("should return 401 when accessing roles without auth token", async () => {
      const res = await request(app).get("/api/roles");
      expect(res.status).toBe(401);
      expect(res.body.message).toContain("token is missing");
    });

    it("should return 400 when creating role with invalid key (contains spaces or uppercase)", async () => {
      const res = await request(app)
        .post("/api/roles")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Invalid Role",
          key: "INVALID KEY WITH SPACES",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("should return 400 when creating role with duplicate name (case-insensitive)", async () => {
      // Query the existing super_admin role to test against its actual name in the database
      const currentRole = await query<{ name: string }>(
        "SELECT name FROM security_roles WHERE key = 'super_admin' LIMIT 1;"
      );
      const roleName = currentRole.rows[0]?.name || "Super Admin";

      const res = await request(app)
        .post("/api/roles")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: roleName.toLowerCase(),
          key: "super_admin_dup_key",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("already exists");
    });

    it("should return 404 when querying role by nonexistent UUID", async () => {
      const fakeUuid = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .get(`/api/roles/${fakeUuid}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain("not found");
    });
  });

  describe("CRUD Operations on /api/roles", () => {
    it("POST /api/roles - creates role and serializes features into delimited string", async () => {
      const payload = {
        name: "Test Compliance Officer",
        key: "test_compliance_officer",
        scope: "One organization",
        description: "Test officer role with granular permissions",
        isActive: true,
        features: [
          {
            id: "feat_partner_review",
            accessLevel: "full",
            actions: [
              { key: "approve_partner", enabled: true },
              { key: "reject_partner", enabled: true },
              { key: "mark_under_review", enabled: true },
              { key: "delete_partner", enabled: false },
            ],
          },
          {
            id: "feat_partner_locations",
            accessLevel: "read_only",
            actions: [
              { key: "view_locations", enabled: true },
              { key: "create_location", enabled: false },
              { key: "edit_location", enabled: false },
              { key: "delete_location", enabled: false },
            ],
          },
        ],
      };

      const res = await request(app)
        .post("/api/roles")
        .set("Authorization", `Bearer ${authToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("role");
      expect(res.body.role.name).toBe("Test Compliance Officer");
      expect(res.body.role.key).toBe("test_compliance_officer");
      expect(res.body.role.status).toBe("Active");
      expect(Array.isArray(res.body.role.features)).toBe(true);

      // Verify hydrated features
      const reviewFeat = res.body.role.features.find((f: any) => f.id === "feat_partner_review");
      expect(reviewFeat).toBeDefined();
      expect(reviewFeat.accessLevel).toBe("full");

      const approveAction = reviewFeat.actions.find((a: any) => a.key === "approve_partner");
      expect(approveAction.enabled).toBe(true);

      const deleteAction = reviewFeat.actions.find((a: any) => a.key === "delete_partner");
      expect(deleteAction.enabled).toBe(false);

      createdRoleId = res.body.role.id;
    });

    it("GET /api/roles - returns roles list with hydrated features and search filter", async () => {
      const res = await request(app)
        .get("/api/roles")
        .set("Authorization", `Bearer ${authToken}`)
        .query({ search: "Compliance Officer" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("roles");
      expect(Array.isArray(res.body.roles)).toBe(true);
      expect(res.body.roles.some((r: any) => r.id === createdRoleId)).toBe(true);
    });

    it("GET /api/roles/:id - fetches single role by ID with hydrated features", async () => {
      const res = await request(app)
        .get(`/api/roles/${createdRoleId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("role");
      expect(res.body.role.id).toBe(createdRoleId);
      expect(res.body.role.name).toBe("Test Compliance Officer");
    });

    it("PUT /api/roles/:id - updates role details and permissions", async () => {
      const res = await request(app)
        .put(`/api/roles/${createdRoleId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          name: "Test Senior Compliance Lead",
          scope: "All organizations",
        });

      expect(res.status).toBe(200);
      expect(res.body.role.name).toBe("Test Senior Compliance Lead");
      expect(res.body.role.scope).toBe("All organizations");
    });

    it("DELETE /api/roles/:id - deletes custom role", async () => {
      const res = await request(app)
        .delete(`/api/roles/${createdRoleId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("deleted successfully");

      // Verify subsequent get returns 404
      const getRes = await request(app)
        .get(`/api/roles/${createdRoleId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(getRes.status).toBe(404);
      createdRoleId = ""; // mark cleaned
    });
  });
});
