/** Support inbox in Master (0631): customer and partner requests in one list; take, note, resolve, all audited. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, tag } from "./helpers/master-kit";

describe("Master: support inbox", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  const orgIds: string[] = [];
  let viewer: TestStaff;
  let handler: TestStaff;
  let customerReq: string;
  let partnerReq: string;
  const marker = `zz-support-${tag()}`;

  beforeAll(async () => {
    viewer = await staffWith({ feat_support: ["view_support"] }, roleKeys);
    handler = await staffWith({ feat_support: ["view_support", "handle_support"] }, roleKeys);
    staffIds.push(viewer.id, handler.id);
    const owner = (
      await query<{ id: string }>(
        `INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1) RETURNING id;`,
        [`owner-${tag()}@test.local`]
      )
    ).rows[0].id;
    staffIds.push(owner);
    const org = (await query<{ id: string }>(`INSERT INTO organizations (name, slug, type) VALUES ($1, $2, 'franchise') RETURNING id;`, [`Support Org ${tag()}`, `support-${tag()}`])).rows[0].id;
    orgIds.push(org);
    customerReq = (await query<{ id: string }>(`INSERT INTO ol_support_requests (topic, message, user_id) VALUES ('order', $1, $2) RETURNING id;`, [`My order is late ${marker}`, owner])).rows[0].id;
    partnerReq = (
      await query<{ id: string }>(`INSERT INTO pos_support_requests (organization_id, topic, message, created_by) VALUES ($1, 'payments', $2, $3) RETURNING id;`, [org, `Payout missing ${marker}`, owner])
    ).rows[0].id;
  });
  afterAll(async () => {
    await query(`DELETE FROM ol_support_requests WHERE id = $1;`, [customerReq]).catch(() => undefined);
    await query(`DELETE FROM pos_support_requests WHERE id = $1;`, [partnerReq]).catch(() => undefined);
    await cleanup({ orgIds, staffIds, roleKeys });
  });

  it("lists customer and partner requests together, open first", async () => {
    const res = await request(app).get("/api/support").query({ q: marker }).set(bearer(viewer));
    expect(res.status).toBe(200);
    const sources = res.body.requests.map((r: { source: string }) => r.source).sort();
    expect(sources).toEqual(["customer", "partner"]);
    expect(res.body.requests.every((r: { status: string }) => r.status === "open")).toBe(true);
  });

  it("a viewer cannot change a request (403); resolving needs a note (400)", async () => {
    expect((await request(app).post(`/api/support/customer/${customerReq}`).set(bearer(viewer)).send({ assign_to_me: true })).status).toBe(403);
    expect((await request(app).post(`/api/support/customer/${customerReq}`).set(bearer(handler)).send({ status: "resolved" })).status).toBe(400);
  });

  it("take it, note, resolve: the detail shows the notes and who raised it (masked); everything is audited", async () => {
    const take = await request(app).post(`/api/support/partner/${partnerReq}`).set(bearer(handler)).send({ assign_to_me: true, status: "in_progress", note: "Checking the payout" });
    expect(take.status).toBe(200);
    expect(take.body.result).toMatchObject({ status: "in_progress", assigned_to: handler.id });
    const done = await request(app).post(`/api/support/partner/${partnerReq}`).set(bearer(handler)).send({ status: "resolved", note: "Paid on Friday, UTR shared" });
    expect(done.status).toBe(200);
    const detail = await request(app).get(`/api/support/partner/${partnerReq}`).set(bearer(viewer));
    expect(detail.body.request).toMatchObject({ status: "resolved" });
    expect(detail.body.request.raised_by).toBeUndefined();
    expect(detail.body.request.raised_by_email).toMatch(/^ow\*\*\*@test\.local$/);
    expect(detail.body.notes.map((n: { note: string }) => n.note)).toEqual(["Checking the payout", "Paid on Friday, UTR shared"]);
    const audit = await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'support_request.updated' AND entity_id = $1;`, [`partner:${partnerReq}`]);
    expect(audit.rows[0].n).toBe(2);
  });

  it("an unknown request is 404", async () => {
    const res = await request(app).get(`/api/support/customer/00000000-0000-0000-0000-0000000000cc`).set(bearer(viewer));
    expect(res.status).toBe(404);
  });
});
