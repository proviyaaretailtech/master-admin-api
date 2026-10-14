/**
 * Every permission the backend checks must be grantable in the role editor.
 *
 * The role editor builds its matrix from GET /api/roles/catalog (the backend permission registry,
 * DEFAULT_FEATURES_TEMPLATE). This test collects every (feature, action) the backend checks:
 *  - route guards, recorded at router construction (catches loops such as the rider/org verb tables),
 *  - in-handler checks (hasPermission / actorCan with literal ids) found in the source,
 *  - the commercial lifecycle actions and the partner-review status actions,
 * and fails if any of them is missing from the catalogue the editor receives.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";

type Check = { feature: string; action: string; where: string };
const recorded = vi.hoisted(() => [] as Array<{ feature: string; action?: string; where: string }>);

vi.mock("../middlewares/permission.middleware", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../middlewares/permission.middleware")>();
  return {
    ...mod,
    requirePermission: (
      featureId: string,
      action?: string,
      level?: "none" | "read_only" | "full"
    ) => {
      recorded.push({ feature: featureId, action, where: "route guard" });
      return mod.requirePermission(featureId, action, level);
    },
    requireAnyPermission: (reqs: Array<{ featureId: string; action?: string }>) => {
      for (const r of reqs)
        recorded.push({ feature: r.featureId, action: r.action, where: "route guard (any)" });
      return mod.requireAnyPermission(reqs);
    },
  };
});

import app from "../index";
import { PLAN_LIFECYCLE, PACK_LIFECYCLE, ADDON_LIFECYCLE } from "../utils/lifecycle";
import { getRequiredPartnerReviewActionForStatus } from "../middlewares/permission.middleware";
import { createStaff, cleanup, TestStaff } from "./helpers/testkit";

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "tests" ? [] : sourceFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [p] : [];
  });
}

/** hasPermission(perms, "feat_x", "action", ...) and actorCan(actor, "feat_x", "action") with literal ids. */
function inHandlerChecks(): Check[] {
  const out: Check[] = [];
  const re = /(?:hasPermission|actorCan)\(\s*[^,()]+,\s*"(feat_[a-z0-9_]+)",\s*"([a-z0-9_]+)"/g;
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(re))
      out.push({ feature: m[1], action: m[2], where: path.relative(SRC, file) });
  }
  return out;
}

function allChecks(): Check[] {
  const checks: Check[] = recorded
    .filter((r): r is Check => typeof r.action === "string" && r.action.length > 0)
    .map((r) => ({ ...r }));
  checks.push(...inHandlerChecks());
  for (const cfg of [PLAN_LIFECYCLE, PACK_LIFECYCLE, ADDON_LIFECYCLE]) {
    checks.push({ feature: cfg.featureId, action: cfg.publishAction, where: "lifecycle" });
    checks.push({ feature: cfg.featureId, action: cfg.retireAction, where: "lifecycle" });
  }
  for (const status of [
    "Approved",
    "Active",
    "Rejected",
    "Suspended",
    "Inactive",
    "Pending",
    "Draft",
    "Other",
  ]) {
    const action = getRequiredPartnerReviewActionForStatus(status, false);
    if (action)
      checks.push({ feature: "feat_partner_review", action, where: `partner status ${status}` });
  }
  return checks;
}

describe("permission coverage: the role editor can grant everything the backend checks", () => {
  let superAdmin: TestStaff;
  let catalogue: Array<{
    id: string;
    actions: Array<{ key: string; enabled: boolean }>;
    accessLevel: string;
  }>;

  beforeAll(async () => {
    superAdmin = await createStaff({ roleKey: "super_admin" });
    const res = await request(app)
      .get("/api/roles/catalog")
      .set("Authorization", `Bearer ${superAdmin.token}`);
    expect(res.status).toBe(200);
    catalogue = res.body.features;
  });
  afterAll(async () => {
    await cleanup({ staffIds: [superAdmin.id] });
  });

  it("the catalogue is complete and blank (nothing pre-granted to a new role)", () => {
    expect(catalogue.length).toBeGreaterThan(20);
    for (const f of catalogue) {
      expect(f.accessLevel).toBe("none");
      for (const a of f.actions) expect(a.enabled).toBe(false);
    }
  });

  it("collected the backend's checks (sanity: the newer Master features are among them)", () => {
    const keys = new Set(allChecks().map((c) => `${c.feature}.${c.action}`));
    expect(keys.size).toBeGreaterThan(50);
    for (const k of [
      "feat_orders.decide_order_holds",
      "feat_partner_review.view_applications",
      "feat_partner_review.approve_partner",
      "feat_partner_review.reject_partner",
      "feat_org_360.suspend_org",
      "feat_riders.reactivate_rider",
      "feat_commercial_plans.publish_plan",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("every feature/action the backend checks is in the catalogue the role editor receives", () => {
    const grantable = new Set(catalogue.flatMap((f) => f.actions.map((a) => `${f.id}.${a.key}`)));
    const missing = allChecks()
      .filter((c) => !grantable.has(`${c.feature}.${c.action}`))
      .map((c) => `${c.feature}.${c.action} (${c.where})`);
    expect([...new Set(missing)]).toEqual([]);
  });
});
