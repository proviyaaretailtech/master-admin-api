/**
 * MA-2 (edit_user / invite_user escalation paths) and MA-3 (deleteUser has no actor checks):
 *  - a role may only be assigned if it is active and grants no more than the assigning admin holds;
 *  - a non-super admin cannot modify (status, role, name, email) or delete staff whose role is stronger;
 *  - an email change is never allowed for a login shared with another application;
 *  - only a Super Administrator can delete a Super Administrator; nobody can delete themselves;
 *  - deleting staff whose login is used by another application removes platform access only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { ensureRole, createStaff, createOrg, cleanup, permString } from "./helpers/testkit";

const USER_MGMT = ["view_users", "invite_user", "edit_user", "delete_user"];
const roleKeys = ["uh_admin", "uh_weak", "uh_strong", "uh_inactive"];

describe("MA-2 / MA-3 staff administration is hierarchical", () => {
  const staffIds: string[] = [];
  const orgIds: string[] = [];
  const createdEmails: string[] = [];
  let admin: Awaited<ReturnType<typeof createStaff>>; // holds user administration only
  let superA: Awaited<ReturnType<typeof createStaff>>;
  let superB: Awaited<ReturnType<typeof createStaff>>;
  let weakRoleId: string;
  let strongRoleId: string;
  let inactiveRoleId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const newWeak = async () => {
    const s = await createStaff({ roleKey: "uh_weak" });
    staffIds.push(s.id);
    return s;
  };
  const emailOf = async (id: string) => (await query<{ email: string }>("SELECT email FROM auth.users WHERE id = $1;", [id])).rows[0]?.email;

  beforeAll(async () => {
    await query("DELETE FROM platform_roles WHERE key = ANY($1);", [roleKeys]);
    await ensureRole({ key: "uh_admin", permissions: permString({ feat_users_mgmt: USER_MGMT }) });
    weakRoleId = await ensureRole({ key: "uh_weak", permissions: permString({ feat_users_mgmt: ["view_users"] }) });
    // strong: holds everything admin holds PLUS organization creation, which admin lacks
    strongRoleId = await ensureRole({
      key: "uh_strong",
      permissions: permString({ feat_users_mgmt: USER_MGMT, feat_org_360: ["view_directory", "create_org"] }),
    });
    inactiveRoleId = await ensureRole({ key: "uh_inactive", permissions: permString({ feat_users_mgmt: ["view_users"] }) });
    await query("UPDATE platform_roles SET is_active = false WHERE id = $1;", [inactiveRoleId]);

    admin = await createStaff({ roleKey: "uh_admin" });
    superA = await createStaff({ roleKey: "super_admin" });
    superB = await createStaff({ roleKey: "super_admin" });
    staffIds.push(admin.id, superA.id, superB.id);
  });

  afterAll(async () => {
    for (const email of createdEmails) await query("DELETE FROM auth.users WHERE lower(email) = lower($1);", [email]);
    await cleanup({ orgIds, staffIds, roleKeys });
  });

  describe("MA-2: assigning roles", () => {
    const create = (token: string, roleId: string | null) => {
      const email = `uh-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
      createdEmails.push(email);
      return request(app)
        .post("/api/users")
        .set(auth(token))
        .send({ first_name: "New", last_name: "Hire", email, password: "a-long-password-1", role_id: roleId });
    };

    it("refuses to create staff with a role that grants more than the inviting admin holds (403)", async () => {
      const res = await create(admin.token, strongRoleId);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Privilege Escalation/);
    });

    it("refuses to create staff with an inactive role (400)", async () => {
      const res = await create(superA.token, inactiveRoleId);
      expect(res.status).toBe(400);
    });

    it("allows creating staff with a role within the admin's own permissions (201)", async () => {
      const res = await create(admin.token, weakRoleId);
      expect(res.status).toBe(201);
      staffIds.push(res.body.user.id);
    });

    it("lets a Super Administrator assign the stronger role (201)", async () => {
      const res = await create(superA.token, strongRoleId);
      expect(res.status).toBe(201);
      staffIds.push(res.body.user.id);
    });

    it("refuses to promote an existing staff member to a role beyond the admin's own (403, role unchanged)", async () => {
      const t = await newWeak();
      const res = await request(app).put(`/api/users/${t.id}`).set(auth(admin.token)).send({ role_id: strongRoleId });
      expect(res.status).toBe(403);
      const row = await query<{ role_id: string }>("SELECT role_id FROM platform_admins WHERE user_id = $1;", [t.id]);
      expect(row.rows[0].role_id).toBe(weakRoleId);
    });

    it("refuses to change one's own role (403)", async () => {
      const res = await request(app).put(`/api/users/${admin.id}`).set(auth(admin.token)).send({ role_id: strongRoleId });
      expect(res.status).toBe(403);
    });

    it("does not re-validate an unchanged role on save (the editor resends the whole object): 200", async () => {
      const t = await createStaff({ roleKey: "uh_inactive" });
      staffIds.push(t.id);
      const res = await request(app)
        .put(`/api/users/${t.id}`)
        .set(auth(admin.token))
        .send({ first_name: "Same", role_id: inactiveRoleId });
      expect(res.status).toBe(200);
    });
  });

  describe("MA-2: modifying staff who hold more than the admin", () => {
    let strong: Awaited<ReturnType<typeof createStaff>>;
    beforeAll(async () => {
      strong = await createStaff({ roleKey: "uh_strong" });
      staffIds.push(strong.id);
    });

    it("cannot change the email of a stronger administrator (the account-takeover path): 403, email unchanged", async () => {
      const before = await emailOf(strong.id);
      const res = await request(app).put(`/api/users/${strong.id}`).set(auth(admin.token)).send({ email: "takeover@test.local" });
      expect(res.status).toBe(403);
      expect(await emailOf(strong.id)).toBe(before);
    });

    it("cannot deactivate or rename a stronger administrator (403)", async () => {
      const a = await request(app).put(`/api/users/${strong.id}`).set(auth(admin.token)).send({ status: "Inactive" });
      expect(a.status).toBe(403);
      const b = await request(app).put(`/api/users/${strong.id}`).set(auth(admin.token)).send({ first_name: "Renamed" });
      expect(b.status).toBe(403);
      const row = await query<{ status: string }>("SELECT status FROM platform_admins WHERE user_id = $1;", [strong.id]);
      expect(row.rows[0].status).toBe("Active");
    });

    it("cannot modify a Super Administrator (403) but a Super Administrator can (200)", async () => {
      const denied = await request(app).put(`/api/users/${superB.id}`).set(auth(admin.token)).send({ first_name: "Nope" });
      expect(denied.status).toBe(403);
      const ok = await request(app).put(`/api/users/${superB.id}`).set(auth(superA.token)).send({ first_name: "Fine" });
      expect(ok.status).toBe(200);
    });

    it("can change the email of a staff member whose role is within the admin's own (200)", async () => {
      const t = await newWeak();
      const email = `uh-changed-${Date.now()}@test.local`;
      const res = await request(app).put(`/api/users/${t.id}`).set(auth(admin.token)).send({ email });
      expect(res.status).toBe(200);
      expect(await emailOf(t.id)).toBe(email);
    });

    it("refuses an email change for a login that is also used by another application (403, email unchanged)", async () => {
      const t = await newWeak();
      const orgId = await createOrg();
      orgIds.push(orgId);
      const role = await query<{ id: string }>("SELECT id FROM roles LIMIT 1;");
      await query(
        "INSERT INTO org_users (organization_id, user_id, role_id, email) VALUES ($1, $2, $3, $4);",
        [orgId, t.id, role.rows[0].id, t.email]
      );
      const res = await request(app).put(`/api/users/${t.id}`).set(auth(superA.token)).send({ email: "shared-change@test.local" });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/another application/);
      expect(await emailOf(t.id)).toBe(t.email);
    });

    it("rejects a malformed user id with 400 instead of a database error", async () => {
      const res = await request(app).get("/api/users/not-a-uuid").set(auth(admin.token));
      expect(res.status).toBe(400);
    });
  });

  describe("MA-3: deleting staff", () => {
    const del = (token: string, id: string) => request(app).delete(`/api/users/${id}`).set(auth(token));

    it("nobody can delete their own account (403), not even a Super Administrator", async () => {
      expect((await del(admin.token, admin.id)).status).toBe(403);
      expect((await del(superA.token, superA.id)).status).toBe(403);
      const still = await query("SELECT 1 FROM platform_admins WHERE user_id = ANY($1);", [[admin.id, superA.id]]);
      expect(still.rows.length).toBe(2);
    });

    it("a non-super holder of delete_user cannot delete a Super Administrator (403)", async () => {
      const victim = await createStaff({ roleKey: "super_admin" });
      staffIds.push(victim.id);
      const res = await del(admin.token, victim.id);
      expect(res.status).toBe(403);
      expect(await emailOf(victim.id)).toBe(victim.email);
    });

    it("cannot delete a staff member whose role is stronger than the admin's (403)", async () => {
      const strong = await createStaff({ roleKey: "uh_strong" });
      staffIds.push(strong.id);
      const res = await del(admin.token, strong.id);
      expect(res.status).toBe(403);
      expect(await emailOf(strong.id)).toBe(strong.email);
    });

    it("deletes a staff member within the admin's own permissions, removing the login (200)", async () => {
      const t = await newWeak();
      const res = await del(admin.token, t.id);
      expect(res.status).toBe(200);
      expect(await emailOf(t.id)).toBeUndefined();
    });

    it("a Super Administrator can delete another Super Administrator while others remain (200)", async () => {
      const spare = await createStaff({ roleKey: "super_admin" });
      staffIds.push(spare.id);
      const res = await del(superA.token, spare.id);
      expect(res.status).toBe(200);
      expect(await emailOf(spare.id)).toBeUndefined();
    });

    it("removes only platform access (keeps the login) when the login is also used by another application (200)", async () => {
      const t = await newWeak();
      const orgId = await createOrg();
      orgIds.push(orgId);
      const role = await query<{ id: string }>("SELECT id FROM roles LIMIT 1;");
      await query(
        "INSERT INTO org_users (organization_id, user_id, role_id, email) VALUES ($1, $2, $3, $4);",
        [orgId, t.id, role.rows[0].id, t.email]
      );
      const res = await del(admin.token, t.id);
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Platform access removed/);
      expect(await emailOf(t.id)).toBe(t.email); // the shared login survives...
      const gone = await query("SELECT 1 FROM platform_admins WHERE user_id = $1;", [t.id]);
      expect(gone.rows.length).toBe(0); // ...but it is no longer platform staff
      const membership = await query("SELECT 1 FROM org_users WHERE user_id = $1;", [t.id]);
      expect(membership.rows.length).toBe(1); // and the restaurant membership is untouched
    });

    it("returns 404 for a staff member that does not exist", async () => {
      const res = await del(superA.token, "00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });
});
