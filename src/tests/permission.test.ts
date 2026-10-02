import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { ensureRole, createStaff, createOrg, cleanup } from "./helpers/testkit";
import { serializeFeaturesToDb, DEFAULT_FEATURES_TEMPLATE } from "../utils/permission-adapter";

describe("Role-Based Access Control (RBAC) & Permission Middleware Integration Tests", () => {
  let superAdminToken: string;

  let unassignedToken: string;

  let restrictedToken: string;
  let restrictedRoleId: string;

  let readOnlyToken: string;

  let reviewerToken: string;

  let contactEditorToken: string;

  let orgCreatorToken: string;

  let nonCreatorToken: string;

  const createdOrgIds: string[] = [];
  const orgIds: string[] = [];
  const staffIds: string[] = [];
  const roleKeys: string[] = [];

  let testOrgId: string;
  let deleteTestOrgId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    // 1. Test organizations (canonical table; each comes with a default location)
    testOrgId = await createOrg({ name: "RBAC Test Org", status: "Draft" });
    orgIds.push(testOrgId);
    // A disposable organization specifically for the delete test
    deleteTestOrgId = await createOrg({ name: "Delete Target Org", status: "Draft" });

    // 2. Super admin (role key = 'super_admin', seeded by migrations)
    const sa = await createStaff({ roleKey: "super_admin" });
    staffIds.push(sa.id);
    superAdminToken = sa.token;

    // 3. Staff with NO role assigned (role_id = NULL) - MUST NOT have any permissions or bypass
    const unassigned = await createStaff({ roleKey: null });
    staffIds.push(unassigned.id);
    unassignedToken = unassigned.token;

    // 4. Restricted Role (Locations completely disabled)
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
    restrictedRoleId = await ensureRole({ key: "restricted_test_role", name: "Restricted Role Test", permissions: restrictedPermissions });
    roleKeys.push("restricted_test_role");
    const restrictedStaff = await createStaff({ roleKey: "restricted_test_role" });
    staffIds.push(restrictedStaff.id);
    restrictedToken = restrictedStaff.token;

    // 5. Read-Only Locations Role (view_locations enabled, create_location disabled)
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
    await ensureRole({ key: "read_only_locations_role", name: "Read Only Locations Test", permissions: readOnlyPermissions });
    roleKeys.push("read_only_locations_role");
    const readOnlyStaff = await createStaff({ roleKey: "read_only_locations_role" });
    staffIds.push(readOnlyStaff.id);
    readOnlyToken = readOnlyStaff.token;

    // 6. Reviewer Role (approve_partner enabled, delete_partner DISABLED, edit_contact_info DISABLED)
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
    await ensureRole({ key: "reviewer_only_test_role", name: "Reviewer Only Test", permissions: reviewerPermissions });
    roleKeys.push("reviewer_only_test_role");
    const reviewerStaff = await createStaff({ roleKey: "reviewer_only_test_role" });
    staffIds.push(reviewerStaff.id);
    reviewerToken = reviewerStaff.token;

    // 7. Contact Editor Role (edit_contact_info enabled, delete_partner DISABLED, review actions DISABLED)
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
    await ensureRole({ key: "contact_editor_test_role", name: "Contact Editor Test", permissions: contactEditorPermissions });
    roleKeys.push("contact_editor_test_role");
    const contactEditorStaff = await createStaff({ roleKey: "contact_editor_test_role" });
    staffIds.push(contactEditorStaff.id);
    contactEditorToken = contactEditorStaff.token;

    // 8. Org Creator Role (create_org + view_directory enabled; review actions DISABLED)
const orgCreatorPermissions = serializeFeaturesToDb(
      DEFAULT_FEATURES_TEMPLATE.map((f) => {
        if (f.id === "feat_org_360") {
          return {
            ...f,
            accessLevel: "full" as const,
            actions: f.actions.map((a) => ({
              ...a,
              enabled: a.key === "create_org" || a.key === "view_directory",
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
    await ensureRole({ key: "org_creator_test_role", name: "Org Creator Test", permissions: orgCreatorPermissions });
    roleKeys.push("org_creator_test_role");
    const orgCreatorStaff = await createStaff({ roleKey: "org_creator_test_role" });
    staffIds.push(orgCreatorStaff.id);
    orgCreatorToken = orgCreatorStaff.token;

    // 9. Non-Creator Role (feat_org_360 accessLevel: 'none', create_org: false)
const nonCreatorPermissions = serializeFeaturesToDb(
      DEFAULT_FEATURES_TEMPLATE.map((f) => {
        if (f.id === "feat_org_360") {
          return {
            ...f,
            accessLevel: "none" as const,
            actions: f.actions.map((a) => ({ ...a, enabled: false })),
          };
        }
        return f;
      })
    );
    await ensureRole({ key: "non_creator_test_role", name: "Non Creator Test", permissions: nonCreatorPermissions });
    roleKeys.push("non_creator_test_role");
    const nonCreatorStaff = await createStaff({ roleKey: "non_creator_test_role" });
    staffIds.push(nonCreatorStaff.id);
    nonCreatorToken = nonCreatorStaff.token;
  });

  afterAll(async () => {
    // Cleanup test staff, roles, and organizations (deleting an org cascades to its locations)
    if (deleteTestOrgId) orgIds.push(deleteTestOrgId);
    await cleanup({ orgIds: [...orgIds, ...createdOrgIds], staffIds, roleKeys });
  });

  describe("API Permissions & User Profile Verification", () => {
    it("GET /api/auth/me - returns current user's permissions and role info from platform_roles", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${restrictedToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toHaveProperty("permissions");
      expect(res.body.user).toHaveProperty("role_details");
      expect(res.body.user.role_details.id).toBe(restrictedRoleId);
      expect(res.body.user.isSuperAdmin).toBe(false);

      const locFeature = res.body.user.permissions.find(
        (f: any) => f.id === "feat_partner_locations"
      );
      expect(locFeature).toBeDefined();
      expect(locFeature.accessLevel).toBe("none");
    });

    it("GET /api/auth/me - returns zero permissions and isSuperAdmin=false for unassigned user", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${unassignedToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.permissions).toEqual([]);
      expect(res.body.user.role_details).toBeNull();
      expect(res.body.user.isSuperAdmin).toBe(false);
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

  describe("Super Admin Bypass (Identified exclusively via key = 'super_admin' in platform_roles)", () => {
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

  describe("Permission Gating: Organization Creation Lifecycle & Review Enforcement (POST /api/organizations)", () => {
    it("creates an organization defaulting to 'Draft' when status is omitted by user with create_org", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${orgCreatorToken}`)
        .send({
          business_name: "Draft Default Lifecycle Org",
          domain: "Retail",
          email: "lifecycle-draft@test.com",
          phone_number: "+15550009944",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("organization");
      expect(res.body.organization.status).toBe("Draft");
      expect(res.body.organization.business_name).toBe("Draft Default Lifecycle Org");
      createdOrgIds.push(res.body.organization.id);
    });

    it("returns 403 Forbidden when user with only create_org attempts to create org with status 'Approved'", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${orgCreatorToken}`)
        .send({
          business_name: "Illegal Approved Org Attempt",
          domain: "Retail",
          email: "illegal-approved@test.com",
          phone_number: "+15550009955",
          status: "Approved",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("approve_partner");
    });

    it("returns 403 Forbidden when user with only create_org attempts to create org with status 'Active'", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${orgCreatorToken}`)
        .send({
          business_name: "Illegal Active Org Attempt",
          domain: "Retail",
          email: "illegal-active@test.com",
          phone_number: "+15550009966",
          status: "Active",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("approve_partner");
    });

    it("returns 403 Forbidden when user with only create_org attempts to create org with status 'Rejected'", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${orgCreatorToken}`)
        .send({
          business_name: "Illegal Rejected Org Attempt",
          domain: "Retail",
          email: "illegal-rejected@test.com",
          phone_number: "+15550009977",
          status: "Rejected",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("reject_partner");
    });

    it("allows user with only create_org to create org with explicit status 'Draft'", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${orgCreatorToken}`)
        .send({
          business_name: "Explicit Draft Org",
          domain: "Retail",
          email: "explicit-draft@test.com",
          phone_number: "+15550009988",
          status: "Draft",
        });

      expect(res.status).toBe(201);
      expect(res.body.organization.status).toBe("Draft");
      createdOrgIds.push(res.body.organization.id);
    });

    it("allows user with only create_org to create org with explicit status 'Pending'", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${orgCreatorToken}`)
        .send({
          business_name: "Explicit Pending Org",
          domain: "Retail",
          email: "explicit-pending@test.com",
          phone_number: "+15550009999",
          status: "Pending",
        });

      expect(res.status).toBe(201);
      expect(res.body.organization.status).toBe("Pending");
      createdOrgIds.push(res.body.organization.id);
    });

    it("allows Super Admin to bypass checks and create organization with status 'Approved'", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          business_name: "SuperAdmin Direct Approved Org",
          domain: "Technology",
          email: "superadmin-approved@test.com",
          phone_number: "+15550009900",
          status: "Approved",
        });

      expect(res.status).toBe(201);
      expect(res.body.organization.status).toBe("Approved");
      createdOrgIds.push(res.body.organization.id);
    });

    it("returns 403 Forbidden when user without create_org attempts to create organization", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${nonCreatorToken}`)
        .send({
          business_name: "Unauthorized Creator Attempt",
          domain: "Retail",
          email: "non-creator-unauth@test.com",
          phone_number: "+15550009901",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("create_org");
    });

    it("returns 403 Forbidden when unassigned user attempts to create organization", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${unassignedToken}`)
        .send({
          business_name: "Unassigned Creator Attempt",
          domain: "Retail",
          email: "unassigned-unauth@test.com",
          phone_number: "+15550009902",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Access Denied");
      expect(res.body.message).toContain("create_org");
    });
  });
});
