/**
 * Customer-app pop-ups are owned by the One Local server. The Master panel reaches them only through these
 * routes: Master checks its own permission, forwards the staff member's session to One Local (stubbed here),
 * and audits every change. The browser never calls One Local directly.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer } from "./helpers/master-kit";

const staffIds: string[] = [];
const roleKeys: string[] = [];
let viewer: TestStaff;
let manager: TestStaff;
const realUrl = process.env.ONE_LOCAL_API_URL;
const POPUP_ID = "6f1c2c3e-0000-4000-8000-000000000634";

function fakeOneLocal(reply: (url: string, method: string, body: Record<string, unknown>) => [number, unknown]) {
  const calls: Array<{ url: string; method: string; auth: string | null; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const method = init.method ?? "GET";
      calls.push({ url, method, auth: headers.Authorization ?? null, body });
      const [status, json] = reply(url, method, body);
      return new Response(JSON.stringify(json), { status });
    })
  );
  return calls;
}

describe("Master: customer-app pop-ups relayed to One Local", () => {
  beforeAll(async () => {
    viewer = await staffWith({ feat_customer_popups: ["view_popups"] }, roleKeys);
    manager = await staffWith({ feat_customer_popups: ["view_popups", "manage_popups"] }, roleKeys);
    staffIds.push(viewer.id, manager.id);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (realUrl === undefined) delete process.env.ONE_LOCAL_API_URL;
    else process.env.ONE_LOCAL_API_URL = realUrl;
  });
  afterAll(async () => {
    await cleanup({ staffIds, roleKeys });
  });

  it("lists through One Local with the viewer's own session", async () => {
    process.env.ONE_LOCAL_API_URL = "http://one-local.test/";
    const calls = fakeOneLocal(() => [200, [{ id: POPUP_ID, status: "draft" }]]);
    const res = await request(app).get("/api/popups").query({ status: "draft" }).set(bearer(viewer));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: POPUP_ID, status: "draft" }]);
    expect(calls).toEqual([
      { url: "http://one-local.test/api/admin/popups?status=draft", method: "GET", auth: `Bearer ${viewer.token}`, body: {} },
    ]);
  });

  it("a viewer cannot change pop-ups, and nothing reaches One Local", async () => {
    process.env.ONE_LOCAL_API_URL = "http://one-local.test";
    const calls = fakeOneLocal(() => [200, {}]);
    expect((await request(app).post("/api/popups").set(bearer(viewer)).send({ title: "Diwali" })).status).toBe(403);
    expect((await request(app).post(`/api/popups/${POPUP_ID}/status`).set(bearer(viewer)).send({ action: "approve" })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("an approval is relayed and audited with the staff member as actor", async () => {
    process.env.ONE_LOCAL_API_URL = "http://one-local.test";
    const calls = fakeOneLocal((_u, _m, body) => [200, { id: POPUP_ID, status: body.action === "approve" ? "approved" : "draft" }]);
    const res = await request(app).post(`/api/popups/${POPUP_ID}/status`).set(bearer(manager)).send({ action: "approve", note: "Looks right" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(calls[0]).toMatchObject({ method: "POST", url: `http://one-local.test/api/admin/popups/${POPUP_ID}/status`, auth: `Bearer ${manager.token}` });
    const audit = await query(`SELECT actor_user_id FROM audit_logs WHERE action = 'popup.approve' AND entity_id = $1 AND actor_user_id = $2;`, [
      POPUP_ID,
      manager.id,
    ]);
    expect(audit.rows).toHaveLength(1);
  });

  it("an unknown action is refused before One Local is called", async () => {
    process.env.ONE_LOCAL_API_URL = "http://one-local.test";
    const calls = fakeOneLocal(() => [200, {}]);
    expect((await request(app).post(`/api/popups/${POPUP_ID}/status`).set(bearer(manager)).send({ action: "publish" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("One Local's own refusal is passed on as its sentence", async () => {
    process.env.ONE_LOCAL_API_URL = "http://one-local.test";
    fakeOneLocal(() => [409, { detail: "This pop-up was already approved.", code: "conflict" }]);
    const res = await request(app).post(`/api/popups/${POPUP_ID}/status`).set(bearer(manager)).send({ action: "approve" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This pop-up was already approved.");
  });

  it("without ONE_LOCAL_API_URL the page is told One Local is not connected", async () => {
    delete process.env.ONE_LOCAL_API_URL;
    const res = await request(app).get("/api/popups").set(bearer(viewer));
    expect(res.status).toBe(503);
  });
});
