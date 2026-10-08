/**
 * Permission matrix for every Master immediate-build endpoint (table in helpers/master-routes.ts):
 *  - no token -> 401
 *  - staff with no role -> 403
 *  - staff holding the feature but NOT the required action -> 403
 *  - write routes: staff holding the action but only read-only access -> 403
 *  - the exact grant gets past the guard (anything but 401/403)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { DEFAULT_FEATURES_TEMPLATE } from "../utils/permission-adapter";
import { createStaff, cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer } from "./helpers/master-kit";
import { MASTER_ROUTES, MRoute } from "./helpers/master-routes";

const staffIds: string[] = [];
const roleKeys: string[] = [];
let noRole: TestStaff;
const cache = new Map<string, TestStaff>();

async function holder(kind: "wrongAction" | "readOnly" | "exact", r: MRoute): Promise<TestStaff> {
  const key = `${kind}:${r.feature}:${r.action}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const f = DEFAULT_FEATURES_TEMPLATE.find((x) => x.id === r.feature)!;
  const others = f.actions.map((a) => a.key).filter((k) => k !== r.action);
  const spec =
    kind === "wrongAction"
      ? { [r.feature!]: others }
      : kind === "readOnly"
        ? { [r.feature!]: { level: "read_only" as const, actions: [r.action!] } }
        : { [r.feature!]: [r.action!] };
  const s = await staffWith(spec, roleKeys);
  staffIds.push(s.id);
  cache.set(key, s);
  return s;
}

describe("Master endpoints: permission matrix", () => {
  beforeAll(async () => {
    noRole = await createStaff({ roleKey: null });
    staffIds.push(noRole.id);
  });
  afterAll(async () => {
    await cleanup({ staffIds, roleKeys });
  });

  it("the new features exist in the catalogue and legacy ids still do", () => {
    const ids = DEFAULT_FEATURES_TEMPLATE.map((f) => f.id);
    for (const id of ["feat_riders", "feat_rider_pay", "feat_commission", "feat_orders", "feat_dispatch", "feat_finance", "feat_dashboard", "feat_integrations", "feat_api_webhooks", "feat_org_subscription", "feat_invitations"]) {
      expect(ids).toContain(id);
    }
    for (const id of ["feat_partner_review", "feat_org_360", "feat_commercial_plans", "feat_users_mgmt", "feat_roles_templates", "feat_audit_compliance"]) {
      expect(ids).toContain(id);
    }
  });

  it.each(MASTER_ROUTES.map((r) => [r.method, r.path, r] as const))("%s %s without a token is 401", async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  describe("staff with no role", () => {
    it.each(MASTER_ROUTES.filter((r) => r.feature).map((r) => [r.method, r.path, r] as const))("%s %s is 403", async (method, path) => {
      const res = await request(app)[method](path).set(bearer(noRole)).send({});
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission|Access Denied/i);
    });
    it.each(MASTER_ROUTES.filter((r) => !r.feature).map((r) => [r.method, r.path] as const))("%s %s needs sign-in only (200)", async (method, path) => {
      const res = await request(app)[method](path).set(bearer(noRole));
      expect(res.status).toBe(200);
    });
  });

  describe("feature held, required action missing", () => {
    it.each(MASTER_ROUTES.filter((r) => r.feature).map((r) => [r.method, r.path, r] as const))("%s %s is 403", async (method, path, r) => {
      const s = await holder("wrongAction", r);
      const res = await request(app)[method](path).set(bearer(s)).send({});
      expect(res.status).toBe(403);
    });
  });

  describe("write routes with read-only access", () => {
    it.each(MASTER_ROUTES.filter((r) => r.write).map((r) => [r.method, r.path, r] as const))("%s %s is 403", async (method, path, r) => {
      const s = await holder("readOnly", r);
      const res = await request(app)[method](path).set(bearer(s)).send({});
      expect(res.status).toBe(403);
    });
  });

  describe("the exact grant passes the guard", () => {
    it.each(MASTER_ROUTES.filter((r) => r.feature).map((r) => [r.method, r.path, r] as const))("%s %s is not 401/403", async (method, path, r) => {
      const s = await holder("exact", r);
      const res = await request(app)[method](path).set(bearer(s)).send({});
      expect([401, 403]).not.toContain(res.status);
    });
  });
});
