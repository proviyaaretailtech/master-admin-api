/**
 * MA-1: a staff member with edit_roles must not be able to grant themselves or others permissions beyond
 * their own, edit their own role or the Super Admin role; only a Super Administrator may create/assign
 * roles with permissions the actor lacks. Also: inactive roles grant nothing, and the permission string
 * cannot be injected into through feature ids / action keys.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { ensureRole, createStaff, cleanup, permString, wireFeature, rolePermissions } from "./helpers/testkit";

const ROLE_MGMT = ["view_roles", "create_roles", "edit_roles", "delete_roles"];
const roleKeys = [
  "esc_editor",
  "esc_peer_weaker",
  "esc_stronger",
  "esc_system",
  "esc_created_ok",
  "esc_created_super",
  "esc_inactive",
  "esc_inject",
];

describe("MA-1 role editing cannot escalate privileges", () => {
  const staffIds: string[] = [];
  let editor: Awaited<ReturnType<typeof createStaff>>;
  let superAdmin: Awaited<ReturnType<typeof createStaff>>;
  let editorRoleId: string;
  let weakerRoleId: string;
  let strongerRoleId: string;
  let strongerBefore: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await query("DELETE FROM platform_roles WHERE key = ANY($1);", [roleKeys]);

    // editor: manages roles, plus READ-ONLY access to the organization directory. NOT users, NOT plans.
    editorRoleId = await ensureRole({
      key: "esc_editor",
      permissions: permString({
        feat_roles_templates: ROLE_MGMT,
        feat_org_360: { level: "read_only", actions: ["view_directory"] },
      }),
    });
    // weaker: strictly a subset of the editor's permissions
    weakerRoleId = await ensureRole({
      key: "esc_peer_weaker",
      permissions: permString({ feat_org_360: { level: "read_only", actions: ["view_directory"] } }),
    });
    // stronger: holds things the editor does not (user administration)
    strongerRoleId = await ensureRole({
      key: "esc_stronger",
      permissions: permString({ feat_roles_templates: ROLE_MGMT, feat_users_mgmt: "all" }),
    });
    strongerBefore = await rolePermissions(strongerRoleId);

    editor = await createStaff({ roleKey: "esc_editor" });
    superAdmin = await createStaff({ roleKey: "super_admin" });
    staffIds.push(editor.id, superAdmin.id);
  });

  afterAll(async () => {
    await cleanup({ staffIds, roleKeys });
  });

  it("refuses to let an edit_roles holder grant themselves every permission by editing their own role (403, nothing stored)", async () => {
    const before = await rolePermissions(editorRoleId);
    const allFull = ["feat_roles_templates", "feat_users_mgmt", "feat_commercial_plans", "feat_org_360"].map((id) =>
      wireFeature(id, ["view_roles", "create_roles", "edit_roles", "delete_roles", "view_users", "invite_user", "edit_user", "delete_user", "publish_plan", "edit_plan", "view_plans", "create_org", "view_directory"])
    );
    const res = await request(app)
      .put(`/api/roles/${editorRoleId}`)
      .set(auth(editor.token))
      .send({ features: allFull });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own role/i);
    expect(await rolePermissions(editorRoleId)).toBe(before);
  });

  it("refuses ANY edit of their own role, even a harmless rename (403)", async () => {
    const res = await request(app).patch(`/api/roles/${editorRoleId}`).set(auth(editor.token)).send({ description: "x" });
    expect(res.status).toBe(403);
  });

  it("refuses to grant another role permissions the editor does not hold (403, nothing stored)", async () => {
    const before = await rolePermissions(weakerRoleId);
    const res = await request(app)
      .put(`/api/roles/${weakerRoleId}`)
      .set(auth(editor.token))
      .send({ features: [wireFeature("feat_users_mgmt", ["view_users", "edit_user"])] });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Privilege Escalation/);
    expect(await rolePermissions(weakerRoleId)).toBe(before);
  });

  it("refuses to raise the access level beyond the editor's own (read_only holder cannot grant full) but may grant read_only", async () => {
    const before = await rolePermissions(weakerRoleId);
    const tooHigh = await request(app)
      .put(`/api/roles/${weakerRoleId}`)
      .set(auth(editor.token))
      .send({ features: [wireFeature("feat_org_360", ["view_directory"], "full")] });
    expect(tooHigh.status).toBe(403);
    expect(await rolePermissions(weakerRoleId)).toBe(before);

    const sameLevel = await request(app)
      .put(`/api/roles/${weakerRoleId}`)
      .set(auth(editor.token))
      .send({ features: [wireFeature("feat_org_360", ["view_directory"], "read_only")] });
    expect(sameLevel.status).toBe(200);
  });

  it("allows editing a role whose permissions stay within the editor's own (200)", async () => {
    const res = await request(app)
      .put(`/api/roles/${weakerRoleId}`)
      .set(auth(editor.token))
      .send({ name: "Esc Peer Weaker Renamed", features: [wireFeature("feat_org_360", ["view_directory"], "read_only")] });
    expect(res.status).toBe(200);
    expect(res.body.role.name).toBe("Esc Peer Weaker Renamed");
  });

  it("refuses to edit, rename or deactivate a role that is stronger than the editor's own (403)", async () => {
    const rename = await request(app).put(`/api/roles/${strongerRoleId}`).set(auth(editor.token)).send({ name: "Pwned" });
    expect(rename.status).toBe(403);
    const deactivate = await request(app).patch(`/api/roles/${strongerRoleId}`).set(auth(editor.token)).send({ isActive: false });
    expect(deactivate.status).toBe(403);
    expect(await rolePermissions(strongerRoleId)).toBe(strongerBefore);
    const row = await query<{ is_active: boolean; name: string }>("SELECT is_active, name FROM platform_roles WHERE id = $1;", [strongerRoleId]);
    expect(row.rows[0].is_active).toBe(true);
    expect(row.rows[0].name).not.toBe("Pwned");
  });

  it("makes the Super Admin role immutable, for everyone including a Super Administrator (403)", async () => {
    const sa = await query<{ id: string; permissions: string; is_active: boolean }>(
      "SELECT id, permissions, is_active FROM platform_roles WHERE key = 'super_admin';"
    );
    const superRoleId = sa.rows[0].id;
    for (const token of [editor.token, superAdmin.token]) {
      const res = await request(app)
        .put(`/api/roles/${superRoleId}`)
        .set(auth(token))
        .send({ isActive: false, features: [wireFeature("feat_org_360", ["view_directory"])] });
      expect(res.status).toBe(403);
    }
    const after = await query<{ permissions: string; is_active: boolean }>("SELECT permissions, is_active FROM platform_roles WHERE id = $1;", [superRoleId]);
    expect(after.rows[0].permissions).toBe(sa.rows[0].permissions);
    expect(after.rows[0].is_active).toBe(true);
  });

  it("lets only a Super Administrator edit a system role (403 for the editor, 200 for super)", async () => {
    const sysId = await ensureRole({
      key: "esc_system",
      is_system: true,
      permissions: permString({ feat_org_360: ["view_directory"] }),
    });
    const denied = await request(app).put(`/api/roles/${sysId}`).set(auth(editor.token)).send({ description: "edited" });
    expect(denied.status).toBe(403);
    const allowed = await request(app).put(`/api/roles/${sysId}`).set(auth(superAdmin.token)).send({ description: "edited by super" });
    expect(allowed.status).toBe(200);
  });

  it("attributes role changes to the staff member in the audit log (the backend connects as the owner, so this must be explicit)", async () => {
    const res = await request(app).put(`/api/roles/${weakerRoleId}`).set(auth(editor.token)).send({ description: "audited change" });
    expect(res.status).toBe(200);
    const audit = await query<{ actor_user_id: string; action: string }>(
      `SELECT actor_user_id, action FROM audit_logs
        WHERE entity_type = 'platform_roles' AND entity_id = $1 AND action = 'platform_roles.update'
        ORDER BY id DESC LIMIT 1;`,
      [weakerRoleId]
    );
    expect(audit.rows[0]?.actor_user_id).toBe(editor.id);
  });

  describe("creating roles", () => {
    it("refuses to create a role with permissions beyond the creator's own (403)", async () => {
      const res = await request(app)
        .post("/api/roles")
        .set(auth(editor.token))
        .send({
          name: "Esc Over Reach",
          key: "esc_created_ok",
          features: [wireFeature("feat_users_mgmt", ["view_users", "delete_user"])],
        });
      expect(res.status).toBe(403);
      const exists = await query("SELECT 1 FROM platform_roles WHERE key = 'esc_created_ok';");
      expect(exists.rows.length).toBe(0);
    });

    it("allows creating a role within the creator's own permissions (201)", async () => {
      const res = await request(app)
        .post("/api/roles")
        .set(auth(editor.token))
        .send({
          name: "Esc Created Ok",
          key: "esc_created_ok",
          features: [wireFeature("feat_org_360", ["view_directory"], "read_only")],
        });
      expect(res.status).toBe(201);
    });

    it("lets a Super Administrator create a role with any permissions (201)", async () => {
      const res = await request(app)
        .post("/api/roles")
        .set(auth(superAdmin.token))
        .send({
          name: "Esc Created Super",
          key: "esc_created_super",
          features: [wireFeature("feat_users_mgmt", ["view_users", "edit_user", "delete_user", "invite_user"])],
        });
      expect(res.status).toBe(201);
      expect(res.body.role.features.find((f: { id: string }) => f.id === "feat_users_mgmt").accessLevel).toBe("full");
    });
  });

  describe("deleting roles", () => {
    it("refuses to delete the editor's own role and a role stronger than the editor's (403)", async () => {
      const own = await request(app).delete(`/api/roles/${editorRoleId}`).set(auth(editor.token));
      expect(own.status).toBe(403);
      const stronger = await request(app).delete(`/api/roles/${strongerRoleId}`).set(auth(editor.token));
      expect(stronger.status).toBe(403);
      const stillThere = await query("SELECT 1 FROM platform_roles WHERE id = ANY($1);", [[editorRoleId, strongerRoleId]]);
      expect(stillThere.rows.length).toBe(2);
    });

    it("allows deleting a role within the editor's own permissions (200)", async () => {
      const disposable = await ensureRole({
        key: "esc_inject",
        permissions: permString({ feat_org_360: { level: "read_only", actions: ["view_directory"] } }),
      });
      const res = await request(app).delete(`/api/roles/${disposable}`).set(auth(editor.token));
      expect(res.status).toBe(200);
    });
  });

  describe("permission string injection", () => {
    it("rejects feature ids and action keys that contain the storage delimiters, or that are unknown (400)", async () => {
      const before = await rolePermissions(weakerRoleId);
      const bad: Array<[string, unknown]> = [
        ["delimiter in feature id", [{ id: "feat_org_360::full::view_directory$$$feat_users_mgmt", accessLevel: "none", actions: [] }]],
        ["unknown feature id", [{ id: "feat_does_not_exist", accessLevel: "full", actions: [] }]],
        ["delimiter in action key", [{ id: "feat_org_360", accessLevel: "full", actions: [{ key: "view_directory$$$feat_users_mgmt::full::delete_user", enabled: true }] }]],
        ["unknown action key", [{ id: "feat_org_360", accessLevel: "full", actions: [{ key: "launch_missiles", enabled: true }] }]],
        ["duplicate feature", [wireFeature("feat_org_360", ["view_directory"]), wireFeature("feat_org_360", ["view_directory"])]],
        ["invalid access level", [{ id: "feat_org_360", accessLevel: "root", actions: [] }]],
      ];
      for (const [label, features] of bad) {
        const res = await request(app).put(`/api/roles/${weakerRoleId}`).set(auth(superAdmin.token)).send({ features });
        expect(res.status, label).toBe(400);
      }
      expect(await rolePermissions(weakerRoleId)).toBe(before);
    });

    it("stores a feature with access level 'none' with no enabled actions", async () => {
      const res = await request(app)
        .put(`/api/roles/${weakerRoleId}`)
        .set(auth(superAdmin.token))
        .send({ features: [wireFeature("feat_org_360", ["view_directory", "create_org"], "none")] });
      expect(res.status).toBe(200);
      const f = res.body.role.features.find((x: { id: string }) => x.id === "feat_org_360");
      expect(f.accessLevel).toBe("none");
      expect(f.actions.every((a: { enabled: boolean }) => a.enabled === false)).toBe(true);
    });
  });

  describe("inactive roles grant nothing", () => {
    it("a staff member whose role is deactivated loses all permissions immediately (403) and /auth/me shows none", async () => {
      const roleId = await ensureRole({ key: "esc_inactive", permissions: permString({ feat_org_360: ["view_directory"] }) });
      const holder = await createStaff({ roleKey: "esc_inactive" });
      staffIds.push(holder.id);

      const ok = await request(app).get("/api/organizations").set(auth(holder.token));
      expect(ok.status).toBe(200);

      await query("UPDATE platform_roles SET is_active = false WHERE id = $1;", [roleId]);
      const denied = await request(app).get("/api/organizations").set(auth(holder.token));
      expect(denied.status).toBe(403);

      const me = await request(app).get("/api/auth/me").set(auth(holder.token));
      expect(me.status).toBe(200);
      expect(me.body.user.isSuperAdmin).toBe(false);
      expect(me.body.user.permissions).toEqual([]);
    });
  });
});
