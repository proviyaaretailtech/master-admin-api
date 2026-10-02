import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { ensureRole, createStaff, cleanup } from "./helpers/testkit";

describe("Auth & Staff Users API Integration Tests", () => {
  const staffIds: string[] = [];
  const createdUserEmails: string[] = [];
  let superAdmin: Awaited<ReturnType<typeof createStaff>>;
  let restricted: Awaited<ReturnType<typeof createStaff>>;
  let noRoleAdmin: Awaited<ReturnType<typeof createStaff>>;
  let inactiveAdmin: Awaited<ReturnType<typeof createStaff>>;
  let authOnlyUserId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    await ensureRole({ key: "authusers_test_restricted_role", name: "AuthUsers Restricted", permissions: "" });
    superAdmin = await createStaff({ roleKey: "super_admin", firstName: "Sue", lastName: "Admin" });
    restricted = await createStaff({ roleKey: "authusers_test_restricted_role" });
    noRoleAdmin = await createStaff({ roleKey: null });
    inactiveAdmin = await createStaff({ roleKey: "super_admin", status: "Inactive" });
    staffIds.push(superAdmin.id, restricted.id, noRoleAdmin.id, inactiveAdmin.id);

    // An auth user that is NOT a platform admin (e.g. a restaurant owner of another app)
    const u = await query<{ id: string }>(
      `INSERT INTO auth.users (id, instance_id, aud, role, email)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1) RETURNING id;`,
      [`outsider-${Date.now()}@test.local`]
    );
    authOnlyUserId = u.rows[0].id;
    staffIds.push(authOnlyUserId);
  });

  afterAll(async () => {
    for (const email of createdUserEmails) {
      await query("DELETE FROM auth.users WHERE lower(email) = lower($1);", [email]);
    }
    await cleanup({ staffIds, roleKeys: ["authusers_test_restricted_role"] });
  });

  describe("GET /api/auth/me", () => {
    it("returns the profile for a valid token", async () => {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${superAdmin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(superAdmin.id);
      expect(res.body.user.email).toBe(superAdmin.email);
      expect(res.body.user.first_name).toBe("Sue");
      expect(res.body.user.isSuperAdmin).toBe(true);
      expect(res.body.user.role_details.key).toBe("super_admin");
    });

    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("returns 401 for an invalid token", async () => {
      const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer garbage");
      expect(res.status).toBe(401);
    });

    it("returns 403 for an auth user with no platform_admins row", async () => {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer test:${authOnlyUserId}`);
      expect(res.status).toBe(403);
    });

    it("returns 403 for an Inactive platform admin", async () => {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${inactiveAdmin.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe("Registration & login", () => {
    it("POST /api/auth/register no longer exists (404)", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ email: "x@test.local", password: "test-password-123", first_name: "X", last_name: "Y" });
      expect(res.status).toBe(404);
    });

    it("POST /api/auth/login succeeds with correct password and returns a usable token", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: superAdmin.email, password: "test-password-123" });
      expect(res.status).toBe(200);
      expect(res.body.token).toBe(superAdmin.token);
      expect(res.body.user.id).toBe(superAdmin.id);

      const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
    });

    it("POST /api/auth/login rejects an unknown password with 401", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: superAdmin.email, password: "wrong-password" });
      expect(res.status).toBe(401);
    });

    it("POST /api/auth/login rejects an unknown email with 401", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: "nobody@test.local", password: "test-password-123" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/users", () => {
    it("creates a staff account for a super admin (201)", async () => {
      const email = `new-staff-${Date.now()}@test.local`;
      createdUserEmails.push(email);
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${superAdmin.token}`)
        .send({
          first_name: "New",
          last_name: "Staffer",
          email,
          phone_number: "+15551230000",
          password: "a-long-password-1",
          role_id: restricted.roleId,
        });
      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.role_id).toBe(restricted.roleId);

      const row = await query<{ status: string }>("SELECT status FROM platform_admins WHERE user_id = $1;", [res.body.user.id]);
      expect(row.rows[0].status).toBe("Active");
    });

    it("is refused (403) for a staff member whose role lacks permission", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${restricted.token}`)
        .send({
          first_name: "Nope",
          last_name: "Denied",
          email: `denied-${Date.now()}@test.local`,
          password: "a-long-password-1",
        });
      expect(res.status).toBe(403);
    });

    it("is refused (401) without a token", async () => {
      const res = await request(app).post("/api/users").send({});
      expect(res.status).toBe(401);
    });
  });
});
