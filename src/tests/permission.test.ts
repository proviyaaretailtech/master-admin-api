import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { signJwtToken } from "../utils/jwt";
import { serializeFeaturesToDb, DEFAULT_FEATURES_TEMPLATE } from "../utils/permission-adapter";

describe("Role-Based Access Control (RBAC) & Permission Middleware Integration Tests", () => {
  let superAdminToken: string;
  let superAdminUserId: string;
  let superAdminRoleId: string;

  let unassignedUserId: string;
  let unassignedToken: string;

  let restrictedUserId: string;
  let restrictedToken: string;
  let restrictedRoleId: string;

  let readOnlyUserId: string;
  let readOnlyToken: string;
  let readOnlyRoleId: string;

  let reviewerUserId: string;
  let reviewerToken: string;
  let reviewerRoleId: string;

  let contactEditorUserId: string;
  let contactEditorToken: string;
  let contactEditorRoleId: string;

  let testOrgId: string;
  let deleteTestOrgId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    // 1. Get or create test organization
    const orgRes = await query<{ id: string }>(
      "SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1;"
    );
    if (orgRes.rows.length > 0) {
      testOrgId = orgRes.rows[0].id;
    } else {
      const newOrg = await query<{ id: string }>(
        `INSERT INTO organizations (business_name, domain, status, email, phone_number)
         VALUES ('RBAC Test Org', 'Restaurant', 'Draft', 'rbac@test.com', '+15550001122')
         RETURNING id;`
      );
      testOrgId = newOrg.rows[0].id;
    }

    // Create a disposable organization specifically for the delete test
    const deleteOrgRes = await query<{ id: string }>(
      `INSERT INTO organizations (business_name, domain, status, email, phone_number)
       VALUES ('Delete Target Org', 'Store', 'Draft', 'deleteme@target.com', '+15550009988')
       RETURNING id;`
    );
    deleteTestOrgId = deleteOrgRes.rows[0].id;

    // 2. Setup Super Admin Role (key = 'super_admin') and Super Admin User
    const saRoleRes = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, is_system, permissions)
       VALUES ('Super Administrator', 'super_admin', 'All organizations', 'Root Super Admin', true, true, '')
       ON CONFLICT (key) DO UPDATE SET is_system = true RETURNING id;`
    );
    superAdminRoleId = saRoleRes.rows[0].id;

    const adminUserRes = await query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE role_id = $1 OR email = 'superadmin@onlatur.com' LIMIT 1;",
      [superAdminRoleId]
    );
    if (adminUserRes.rows.length > 0) {
      superAdminUserId = adminUserRes.rows[0].id;
      await query("UPDATE users SET role_id = $1 WHERE id = $2;", [superAdminRoleId, superAdminUserId]);
      superAdminToken = signJwtToken({ userId: superAdminUserId, email: adminUserRes.rows[0].email });
    } else {
      const newAdmin = await query<{ id: string; email: string }>(
        `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
         VALUES ('Super', 'Admin', 'superadmin@onlatur.com', '+15550003344', 'hash', 'Active', $1)
         RETURNING id, email;`,
        [superAdminRoleId]
      );
      superAdminUserId = newAdmin.rows[0].id;
      superAdminToken = signJwtToken({ userId: superAdminUserId, email: newAdmin.rows[0].email });
    }

    // 3. User with NO role assigned (role_id = NULL) - MUST NOT have any permissions or bypass
    const unassignedRes = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('Unassigned', 'User', 'unassigned-user@test.com', '+15550004455', 'hash', 'Active', NULL)
       RETURNING id, email;`
    );
    unassignedUserId = unassignedRes.rows[0].id;
    unassignedToken = signJwtToken({ userId: unassignedUserId, email: unassignedRes.rows[0].email });

    // 4. Create Restricted Role (Locations completely disabled)
    const restrictedPermissions = serializeFeaturesToDb(
      DEFAULT_FEATURES_TEMPLATE.map((f) => {
        if (f.id === "feat_partner_locations") {
          return {
            ...f,
            accessLevel: "none" as const,
            actions: f.actions.map((a) => ({ ...a, enabled: false })),
          };
        }
        return f;
      })
    );

    const resRole = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, permissions)
       VALUES ('Restricted Role Test', 'restricted_test_role', 'One organization', 'No location access', true, $1)
       ON CONFLICT (key) DO UPDATE SET permissions = EXCLUDED.permissions RETURNING id;`,
      [restrictedPermissions]
    );
    restrictedRoleId = resRole.rows[0].id;

    // Create user with Restricted Role
    const resUser = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('Restricted', 'User', 'restricted-user@test.com', '+15550005566', 'hash', 'Active', $1)
       RETURNING id, email;`,
      [restrictedRoleId]
    );
    restrictedUserId = resUser.rows[0].id;
    restrictedToken = signJwtToken({ userId: restrictedUserId, email: resUser.rows[0].email });

    // 5. Create Read-Only Locations Role (view_locations enabled, create_location disabled)
    const readOnlyPermissions = serializeFeaturesToDb(
      DEFAULT_FEATURES_TEMPLATE.map((f) => {
        if (f.id === "feat_partner_locations") {
          return {
            ...f,
            accessLevel: "read_only" as const,
            actions: f.actions.map((a) => ({ ...a, enabled: a.key === "view_locations" })),
          };
        }
        return f;
      })
    );

    const roRole = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, permissions)
       VALUES ('Read Only Locations Test', 'read_only_locations_role', 'One organization', 'View locations only', true, $1)
       ON CONFLICT (key) DO UPDATE SET permissions = EXCLUDED.permissions RETURNING id;`,
      [readOnlyPermissions]
    );
    readOnlyRoleId = roRole.rows[0].id;

    const roUser = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('ReadOnly', 'User', 'readonly-user@test.com', '+15550007788', 'hash', 'Active', $1)
       RETURNING id, email;`,
      [readOnlyRoleId]
    );
    readOnlyUserId = roUser.rows[0].id;
    readOnlyToken = signJwtToken({ userId: readOnlyUserId, email: roUser.rows[0].email });

    // 6. Create Reviewer Role (approve_partner enabled, delete_partner DISABLED, edit_contact_info DISABLED)
    const reviewerPermissions = serializeFeaturesToDb(
      DEFAULT_FEATURES_TEMPLATE.map((f) => {
        if (f.id === "feat_partner_review") {
          return {
            ...f,
            accessLevel: "full" as const,
            actions: f.actions.map((a) => ({
              ...a,
              enabled: a.key === "approve_partner",
            })),
          };
        }
        if (f.id === "feat_partner_docs") {
          return {
            ...f,
            accessLevel: "none" as const,
            actions: f.actions.map((a) => ({ ...a, enabled: false })),
          };
        }
        return f;
      })
    );

    const revRoleRes = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, permissions)
       VALUES ('Reviewer Only Test', 'reviewer_only_test_role', 'One organization', 'Can approve, cannot delete or edit contact', true, $1)
       ON CONFLICT (key) DO UPDATE SET permissions = EXCLUDED.permissions RETURNING id;`,
      [reviewerPermissions]
    );
    reviewerRoleId = revRoleRes.rows[0].id;

    const revUserRes = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('Reviewer', 'User', 'reviewer-user@test.com', '+15550008899', 'hash', 'Active', $1)
       RETURNING id, email;`,
      [reviewerRoleId]
    );
    reviewerUserId = revUserRes.rows[0].id;
    reviewerToken = signJwtToken({ userId: reviewerUserId, email: revUserRes.rows[0].email });

    // 7. Create Contact Editor Role (edit_contact_info enabled, delete_partner DISABLED, review actions DISABLED)
    const contactEditorPermissions = serializeFeaturesToDb(
      DEFAULT_FEATURES_TEMPLATE.map((f) => {
        if (f.id === "feat_partner_docs") {
          return {
            ...f,
            accessLevel: "full" as const,
            actions: f.actions.map((a) => ({
              ...a,
              enabled: a.key === "edit_contact_info",
            })),
          };
        }
        if (f.id === "feat_partner_review") {
          return {
            ...f,
            accessLevel: "none" as const,
            actions: f.actions.map((a) => ({ ...a, enabled: false })),
          };
        }
        return f;
      })
    );

    const ceRoleRes = await query<{ id: string }>(
      `INSERT INTO security_roles (name, key, scope, description, is_active, permissions)
       VALUES ('Contact Editor Test', 'contact_editor_test_role', 'One organization', 'Can edit contact, cannot delete or review', true, $1)
       ON CONFLICT (key) DO UPDATE SET permissions = EXCLUDED.permissions RETURNING id;`,
      [contactEditorPermissions]
    );
    contactEditorRoleId = ceRoleRes.rows[0].id;

    const ceUserRes = await query<{ id: string; email: string }>(
      `INSERT INTO users (first_name, last_name, email, phone_number, password, status, role_id)
       VALUES ('ContactEditor', 'User', 'contact-editor@test.com', '+15550009911', 'hash', 'Active', $1)
       RETURNING id, email;`,
      [contactEditorRoleId]
    );
    contactEditorUserId = ceUserRes.rows[0].id;
    contactEditorToken = signJwtToken({ userId: contactEditorUserId, email: ceUserRes.rows[0].email });
  });

  afterAll(async () => {
    // Cleanup test users, roles, and organizations
    if (unassignedUserId) await query("DELETE FROM users WHERE id = $1;", [unassignedUserId]);
    if (restrictedUserId) await query("DELETE FROM users WHERE id = $1;", [restrictedUserId]);
    if (readOnlyUserId) await query("DELETE FROM users WHERE id = $1;", [readOnlyUserId]);
    if (reviewerUserId) await query("DELETE FROM users WHERE id = $1;", [reviewerUserId]);
    if (contactEditorUserId) await query("DELETE FROM users WHERE id = $1;", [contactEditorUserId]);

    if (restrictedRoleId) await query("DELETE FROM security_roles WHERE id = $1;", [restrictedRoleId]);
    if (readOnlyRoleId) await query("DELETE FROM security_roles WHERE id = $1;", [readOnlyRoleId]);
    if (reviewerRoleId) await query("DELETE FROM security_roles WHERE id = $1;", [reviewerRoleId]);
    if (contactEditorRoleId) await query("DELETE FROM security_roles WHERE id = $1;", [contactEditorRoleId]);

    if (deleteTestOrgId) await query("DELETE FROM organizations WHERE id = $1;", [deleteTestOrgId]);
  });

  describe("API Permissions Endpoint", () => {
    it("GET /api/auth/permissions - returns current user's permissions and role info from security_roles", async () => {
      const res = await request(app)
        .get("/api/auth/permissions")
        .set("Authorization", `Bearer ${restrictedToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("permissions");
      expect(res.body).toHaveProperty("role");
      expect(res.body.role.id).toBe(restrictedRoleId);
      expect(res.body.isSuperAdmin).toBe(false);

      const locFeature = res.body.permissions.find((f: any) => f.id === "feat_partner_locations");
      expect(locFeature).toBeDefined();
      expect(locFeature.accessLevel).toBe("none");
    });

    it("GET /api/auth/permissions - returns zero permissions and isSuperAdmin=false for unassigned user", async () => {
      const res = await request(app)
        .get("/api/auth/permissions")
        .set("Authorization", `Bearer ${unassignedToken}`);

      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual([]);
      expect(res.body.role).toBeNull();
      expect(res.body.isSuperAdmin).toBe(false);
    });
  });

  describe("Permission Gating: Unassigned User (role_id: NULL)", () => {
    it("should return 403 Forbidden when unassigned user attempts to list locations", async () => {
      const res = await request(app)
        .get(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${unassignedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
    });

    it("should return 403 Forbidden when unassigned user attempts to delete an organization", async () => {
      const res = await request(app)
        .delete(`/api/organizations/${deleteTestOrgId}`)
        .set("Authorization", `Bearer ${unassignedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
    });
  });

  describe("Permission Gating: Restricted User (accessLevel: none)", () => {
    it("should return 403 Forbidden when restricted user attempts to list locations", async () => {
      const res = await request(app)
        .get(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("feat_partner_locations");
    });

    it("should return 403 Forbidden when restricted user attempts to create a location", async () => {
      const res = await request(app)
        .post(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${restrictedToken}`)
        .send({
          name: "Unauthorized Outlet",
          type: "Restaurant",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
    });
  });

  describe("Permission Gating: Read-Only User (accessLevel: read_only, view_locations: true)", () => {
    it("should allow (200 OK) read-only user to list locations", async () => {
      const res = await request(app)
        .get(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${readOnlyToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("locations");
    });

    it("should return 403 Forbidden when read-only user attempts to create a location", async () => {
      const res = await request(app)
        .post(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${readOnlyToken}`)
        .send({
          name: "Blocked Create Attempt",
          type: "Restaurant",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
    });
  });

  describe("Permission Gating: Partner Deletion Security (DELETE /api/organizations/:id)", () => {
    it("should return 403 Forbidden when reviewer without delete_partner attempts to delete partner", async () => {
      const res = await request(app)
        .delete(`/api/organizations/${deleteTestOrgId}`)
        .set("Authorization", `Bearer ${reviewerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("delete_partner");
    });

    it("should return 403 Forbidden when contact editor attempts to delete partner", async () => {
      const res = await request(app)
        .delete(`/api/organizations/${deleteTestOrgId}`)
        .set("Authorization", `Bearer ${contactEditorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("delete_partner");
    });
  });

  describe("Permission Gating: Partner Edit Security (PUT /api/organizations/:id)", () => {
    it("should return 403 Forbidden when reviewer attempts to edit contact/profile information", async () => {
      const res = await request(app)
        .put(`/api/organizations/${testOrgId}`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          business_name: "Unauthorized Name Change Attempt",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("edit_contact_info");
    });

    it("should return 403 Forbidden when contact editor attempts to approve partner status", async () => {
      const res = await request(app)
        .put(`/api/organizations/${testOrgId}`)
        .set("Authorization", `Bearer ${contactEditorToken}`)
        .send({
          status: "Approved",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("approve_partner");
    });

    it("should allow (200 OK) reviewer to approve partner status", async () => {
      const res = await request(app)
        .put(`/api/organizations/${testOrgId}`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          status: "Approved",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("organization");
      expect(res.body.organization.status).toBe("Approved");
    });

    it("should allow (200 OK) contact editor to update partner business details", async () => {
      const res = await request(app)
        .put(`/api/organizations/${testOrgId}`)
        .set("Authorization", `Bearer ${contactEditorToken}`)
        .send({
          business_name: "RBAC Updated Business Name",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("organization");
      expect(res.body.organization.business_name).toBe("RBAC Updated Business Name");
    });
  });

  describe("Super Admin Bypass (Identified exclusively via key = 'super_admin' in security_roles)", () => {
    it("should allow Super Admin full access without restrictions on locations", async () => {
      const res = await request(app)
        .get(`/api/organizations/${testOrgId}/locations`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("locations");
    });

    it("should allow Super Admin to delete organization with unrestricted bypass", async () => {
      const res = await request(app)
        .delete(`/api/organizations/${deleteTestOrgId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      deleteTestOrgId = ""; // already deleted
    });
  });
});
