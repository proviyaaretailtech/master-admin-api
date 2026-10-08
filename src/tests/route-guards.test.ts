/**
 * Authorization coverage: every API route except the three public ones must reject an unauthenticated caller
 * (401) and a signed-in staff member with no role/permissions (403). The route table below is checked against
 * the router itself, so adding a route without adding it here (and so without checking its guard) fails.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { createStaff, cleanup } from "./helpers/testkit";
import { MASTER_ROUTES } from "./helpers/master-routes";

const ID = "00000000-0000-0000-0000-000000000001";
const ID2 = "00000000-0000-0000-0000-000000000002";

type Route = [method: "get" | "post" | "put" | "patch" | "delete", path: string];
const PUBLIC: Route[] = [
  ["get", "/api/health"],
  ["post", "/api/auth/login"],
  ["post", "/api/auth/logout"],
];
const PROFILE: Route[] = [["get", "/api/auth/me"]]; // any signed-in staff member (no feature permission)
const GUARDED: Route[] = [
  ["get", "/api/users"], ["post", "/api/users"], ["get", `/api/users/${ID}`], ["put", `/api/users/${ID}`], ["delete", `/api/users/${ID}`],
  ["post", "/api/organizations"], ["get", "/api/organizations"], ["get", `/api/organizations/${ID}`],
  ["put", `/api/organizations/${ID}`], ["patch", `/api/organizations/${ID}`], ["delete", `/api/organizations/${ID}`],
  ["post", `/api/organizations/${ID}/locations`], ["get", `/api/organizations/${ID}/locations`],
  ["get", `/api/organizations/${ID}/locations/${ID2}`], ["put", `/api/organizations/${ID}/locations/${ID2}`],
  ["patch", `/api/organizations/${ID}/locations/${ID2}`], ["delete", `/api/organizations/${ID}/locations/${ID2}`],
  ["get", "/api/roles"], ["get", `/api/roles/${ID}`], ["post", "/api/roles"], ["put", `/api/roles/${ID}`], ["patch", `/api/roles/${ID}`], ["delete", `/api/roles/${ID}`],
  ["get", "/api/security-roles"], ["get", `/api/security-roles/${ID}`], ["post", "/api/security-roles"], ["put", `/api/security-roles/${ID}`], ["patch", `/api/security-roles/${ID}`], ["delete", `/api/security-roles/${ID}`],
  ["get", "/api/commercials/plans"], ["get", `/api/commercials/plans/${ID}`], ["post", "/api/commercials/plans"], ["put", `/api/commercials/plans/${ID}`], ["patch", `/api/commercials/plans/${ID}`],
  ["post", `/api/commercials/plans/${ID}/publish`], ["post", `/api/commercials/plans/${ID}/duplicate`], ["post", `/api/commercials/plans/${ID}/retire`], ["delete", `/api/commercials/plans/${ID}`],
  ["get", "/api/commercials/modules"], ["get", `/api/commercials/modules/${ID}`], ["post", "/api/commercials/modules"], ["put", `/api/commercials/modules/${ID}`], ["delete", `/api/commercials/modules/${ID}`],
  ["get", "/api/commercials/packs"], ["get", `/api/commercials/packs/${ID}`], ["post", "/api/commercials/packs"], ["put", `/api/commercials/packs/${ID}`], ["patch", `/api/commercials/packs/${ID}`],
  ["post", `/api/commercials/packs/${ID}/publish`], ["post", `/api/commercials/packs/${ID}/retire`], ["delete", `/api/commercials/packs/${ID}`],
  ["get", "/api/commercials/add-ons"], ["get", "/api/commercials/add-ons/categories"], ["get", `/api/commercials/add-ons/${ID}`], ["post", "/api/commercials/add-ons"],
  ["put", `/api/commercials/add-ons/${ID}`], ["patch", `/api/commercials/add-ons/${ID}`],
  ["post", `/api/commercials/add-ons/${ID}/publish`], ["post", `/api/commercials/add-ons/${ID}/retire`], ["delete", `/api/commercials/add-ons/${ID}`],
];

/** Counts the method+path routes registered on an Express router, recursively (mounted routers included). */
function countRoutes(stack: unknown[]): number {
  let n = 0;
  for (const layer of stack as Array<{ route?: { methods: Record<string, boolean> }; name?: string; handle?: { stack?: unknown[] } }>) {
    if (layer.route) n += Object.keys(layer.route.methods).filter((m) => layer.route!.methods[m]).length;
    else if (layer.name === "router" && layer.handle?.stack) n += countRoutes(layer.handle.stack);
  }
  return n;
}

describe("route guards", () => {
  const staffIds: string[] = [];
  let noRole: Awaited<ReturnType<typeof createStaff>>;

  beforeAll(async () => {
    noRole = await createStaff({ roleKey: null });
    staffIds.push(noRole.id);
  });
  afterAll(async () => {
    await cleanup({ staffIds });
  });

  it("the table above lists every route the app registers (add new routes here so their guard is checked)", () => {
    // the app also registers "/" (info banner), counted separately from the /api routes
    const router = (app as unknown as { _router: { stack: unknown[] } })._router.stack;
    const total = countRoutes(router);
    // MASTER_ROUTES (helpers/master-routes.ts) lists the Master immediate-build endpoints; master-guards.test.ts checks their guards
    expect(total).toBe(1 + PUBLIC.length + PROFILE.length + GUARDED.length + MASTER_ROUTES.length);
  });

  it.each(GUARDED)("%s %s rejects an unauthenticated caller (401)", async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it.each(GUARDED)("%s %s rejects a staff member with no role (403)", async (method, path) => {
    const res = await request(app)[method](path).set("Authorization", `Bearer ${noRole.token}`).send({});
    expect(res.status).toBe(403);
  });

  it("the profile route needs a signed-in platform admin but no feature permission", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${noRole.token}`)).status).toBe(200);
  });
});
