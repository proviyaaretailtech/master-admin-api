import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, createOrg, cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, seedCity, seedRider, seedJob, wipeOrgData } from "./helpers/master-kit";

describe("Master: riders, cash deposits, rider pay, commission rules", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  const orgIds: string[] = [];
  const riderIds: string[] = [];
  let sa: TestStaff;
  let ops: TestStaff; // riders + rider pay + commission, not super admin
  let city: string;

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin" });
    ops = await staffWith(
      {
        feat_riders: "all",
        feat_rider_pay: "all",
        feat_commission: "all",
      },
      roleKeys
    );
    staffIds.push(sa.id, ops.id);
    city = await seedCity();
  });
  afterAll(async () => {
    await wipeOrgData(orgIds);
    await query("DELETE FROM rider_cash_entries WHERE rider_id = ANY($1::uuid[]);", [riderIds]).catch(() => undefined);
    await query("DELETE FROM rider_cash_deposits WHERE rider_id = ANY($1::uuid[]);", [riderIds]).catch(() => undefined);
    await query("DELETE FROM riders WHERE id = ANY($1::uuid[]);", [riderIds]).catch(() => undefined);
    await query("DELETE FROM rider_policies WHERE city_id = $1;", [city]).catch(() => undefined);
    await query("DELETE FROM rider_rate_cards WHERE city_id = $1;", [city]).catch(() => undefined);
    await cleanup({ orgIds, staffIds, roleKeys });
  });

  // ------------------------------------------------------------------ riders
  describe("GET /riders and /riders/:id", () => {
    let rid: string;
    beforeAll(async () => {
      rid = await seedRider({ status: "submitted", city, name: "Zed Finder Rider" });
      riderIds.push(rid);
      await seedRider({ status: "approved", city }).then((id) => riderIds.push(id));
    });
    it("lists with status, city, q filters and pagination", async () => {
      const all = await request(app).get("/api/riders").query({ city }).set(bearer(ops));
      expect(all.status).toBe(200);
      expect(all.body.pagination.total).toBe(2);
      const sub = await request(app).get("/api/riders").query({ city, status: "submitted" }).set(bearer(ops));
      expect(sub.body.riders.map((r: { id: string }) => r.id)).toEqual([rid]);
      const q = await request(app).get("/api/riders").query({ city, q: "zed finder" }).set(bearer(ops));
      expect(q.body.riders).toHaveLength(1);
      const page = await request(app).get("/api/riders").query({ city, limit: 1, page: 2 }).set(bearer(ops));
      expect(page.body.riders).toHaveLength(1);
      expect(page.body.pagination).toMatchObject({ total: 2, page: 2, limit: 1, totalPages: 2 });
    });
    it("rejects an invalid status filter or page (400)", async () => {
      expect((await request(app).get("/api/riders").query({ status: "flying" }).set(bearer(ops))).status).toBe(400);
      expect((await request(app).get("/api/riders").query({ page: 0 }).set(bearer(ops))).status).toBe(400);
    });
    it("returns the rider 360 (documents, earnings, cash, deposits) and 404s an unknown id", async () => {
      const res = await request(app).get(`/api/riders/${rid}`).set(bearer(ops));
      expect(res.status).toBe(200);
      expect(res.body.rider.id).toBe(rid);
      expect(res.body.cash).toMatchObject({ in_hand_minor: 0, currency_code: "INR" });
      for (const k of ["documents", "earnings", "deposits", "recent_jobs", "payouts"]) expect(Array.isArray(res.body[k])).toBe(true);
      expect((await request(app).get("/api/riders/00000000-0000-0000-0000-0000000000a1").set(bearer(ops))).status).toBe(404);
      expect((await request(app).get("/api/riders/xyz").set(bearer(ops))).status).toBe(400);
    });
  });

  describe("rider status actions", () => {
    it("approve -> suspend -> reactivate with reasons, attributed to the acting staff", async () => {
      const rid = await seedRider({ status: "submitted", city });
      riderIds.push(rid);
      const a = await request(app).post(`/api/riders/${rid}/approve`).set(bearer(ops)).send({});
      expect(a.status).toBe(200);
      expect(a.body.status).toBe("approved");
      const noReason = await request(app).post(`/api/riders/${rid}/suspend`).set(bearer(ops)).send({});
      expect(noReason.status).toBe(400);
      const s = await request(app).post(`/api/riders/${rid}/suspend`).set(bearer(ops)).send({ reason: "Customer complaint" });
      expect(s.status).toBe(200);
      expect(s.body.status).toBe("suspended");
      const r = await request(app).post(`/api/riders/${rid}/reactivate`).set(bearer(ops)).send({ reason: "Cleared after review" });
      expect(r.body.status).toBe("approved");
      const audit = await query("SELECT actor_user_id FROM audit_logs WHERE action = 'master.rider_status' AND entity_id = $1;", [rid]);
      expect(audit.rows).toHaveLength(3);
      expect(audit.rows.every((x) => x.actor_user_id === ops.id)).toBe(true);
    });
    it("reject needs a reason; rejected is terminal (409); wrong transitions are 409", async () => {
      const rid = await seedRider({ status: "submitted", city });
      riderIds.push(rid);
      expect((await request(app).post(`/api/riders/${rid}/reject`).set(bearer(ops)).send({})).status).toBe(400);
      expect((await request(app).post(`/api/riders/${rid}/reject`).set(bearer(ops)).send({ reason: "Documents unreadable" })).status).toBe(200);
      const again = await request(app).post(`/api/riders/${rid}/approve`).set(bearer(ops)).send({});
      expect(again.status).toBe(409);
      expect(again.body.errorCode).toBe("master_terminal");
      const fresh = await seedRider({ status: "submitted", city });
      riderIds.push(fresh);
      const bad = await request(app).post(`/api/riders/${fresh}/suspend`).set(bearer(ops)).send({ reason: "not approved yet" });
      expect(bad.status).toBe(409);
      expect(bad.body.errorCode).toBe("master_bad_transition");
    });
    it("refuses to suspend a rider with a live delivery (409) and 404s unknown riders", async () => {
      const org = await createOrg({ status: "Active" });
      orgIds.push(org);
      const rid = await seedRider({ status: "approved", city });
      riderIds.push(rid);
      await seedJob(org, { status: "assigned", city, rider: rid });
      const res = await request(app).post(`/api/riders/${rid}/suspend`).set(bearer(ops)).send({ reason: "Safety" });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe("master_rider_busy");
      expect((await request(app).post("/api/riders/00000000-0000-0000-0000-0000000000a2/approve").set(bearer(ops)).send({})).status).toBe(404);
    });
  });

  // ----------------------------------------------------------- cash deposits
  describe("rider cash deposits", () => {
    let rid: string;
    const deposit = async (amount = 5000) => {
      const r = await query<{ id: string }>("INSERT INTO rider_cash_deposits (rider_id, amount_minor, currency_code, status) VALUES ($1, $2, 'INR', 'pending') RETURNING id;", [rid, amount]);
      return r.rows[0].id;
    };
    beforeAll(async () => {
      rid = await seedRider({ status: "approved", city });
      riderIds.push(rid);
    });
    it("lists deposits by status with rider name, money in minor units plus currency", async () => {
      const d = await deposit(7000);
      const res = await request(app).get("/api/rider-cash-deposits").query({ status: "pending", rider_id: rid }).set(bearer(ops));
      expect(res.status).toBe(200);
      const row = res.body.deposits.find((x: { id: string }) => x.id === d);
      expect(row).toMatchObject({ amount_minor: 7000, currency_code: "INR", status: "pending" });
      expect(row.rider_name).toBeTruthy();
      expect((await request(app).get("/api/rider-cash-deposits").query({ status: "weird" }).set(bearer(ops))).status).toBe(400);
    });
    it("confirm posts one cash-ledger entry; confirming again is a no-op; reject after confirm is 409", async () => {
      const d = await deposit(5000);
      const ok = await request(app).post(`/api/rider-cash-deposits/${d}/confirm`).set(bearer(ops)).send({ note: "Counted at hub" });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ status: "confirmed", amount_minor: 5000, currency_code: "INR" });
      const again = await request(app).post(`/api/rider-cash-deposits/${d}/confirm`).set(bearer(ops)).send({});
      expect(again.body.changed).toBe(false);
      const entries = await query("SELECT 1 FROM rider_cash_entries WHERE reference = $1;", [`deposit:${d}`]);
      expect(entries.rows).toHaveLength(1);
      const rej = await request(app).post(`/api/rider-cash-deposits/${d}/reject`).set(bearer(ops)).send({ note: "too late" });
      expect(rej.status).toBe(409);
    });
    it("reject needs a note (400), records the decision, and unknown deposits are 404", async () => {
      const d = await deposit(1200);
      expect((await request(app).post(`/api/rider-cash-deposits/${d}/reject`).set(bearer(ops)).send({})).status).toBe(400);
      const ok = await request(app).post(`/api/rider-cash-deposits/${d}/reject`).set(bearer(ops)).send({ note: "Amount does not match" });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("rejected");
      const audit = await query("SELECT actor_user_id, after FROM audit_logs WHERE action = 'master.cash_deposit_rejected' AND entity_id = $1;", [d]);
      expect(audit.rows[0].actor_user_id).toBe(ops.id);
      expect(audit.rows[0].after.note).toBe("Amount does not match");
      expect((await request(app).post("/api/rider-cash-deposits/00000000-0000-0000-0000-0000000000a3/confirm").set(bearer(ops)).send({})).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------- rider pay
  describe("GET /cities and rider pay", () => {
    it("lists service areas", async () => {
      const res = await request(app).get("/api/cities").set(bearer(ops));
      expect(res.status).toBe(200);
      expect(res.body.cities.map((c: { city_id: string }) => c.city_id)).toContain(city);
    });
    it("rate card: none yet, then versioned PUT keeps history and one active card", async () => {
      const none = await request(app).get(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops));
      expect(none.status).toBe(200);
      expect(none.body.rate_card).toBeNull();
      const put1 = await request(app).put(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops)).send({ base_minor: 2500, per_km_minor: 800, min_minor: 3000, active: true });
      expect(put1.status).toBe(200);
      expect(put1.body.rate_card).toMatchObject({ base_minor: 2500, per_km_minor: 800, min_minor: 3000, currency_code: "INR", active: true });
      const put2 = await request(app).put(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops)).send({ base_minor: 3000, per_km_minor: 900, min_minor: 3500, active: true });
      expect(put2.body.rate_card.base_minor).toBe(3000);
      const get = await request(app).get(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops));
      expect(get.body.history).toHaveLength(2);
      expect(get.body.history.filter((h: { active: boolean }) => h.active)).toHaveLength(1);
      const same = await request(app).put(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops)).send({ base_minor: 3000, per_km_minor: 900, min_minor: 3500, active: true });
      expect(same.status).toBe(200);
      expect((await request(app).get(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops))).body.history).toHaveLength(2); // unchanged value = no new version
      const off = await request(app).put(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops)).send({ base_minor: 3000, per_km_minor: 900, min_minor: 3500, active: false });
      expect(off.body.rate_card).toBeNull();
      const audit = await query("SELECT 1 FROM audit_logs WHERE action = 'master.rate_card_set' AND actor_user_id = $1;", [ops.id]);
      expect(audit.rows.length).toBeGreaterThanOrEqual(2);
    });
    it("rate card validation: negative / fractional / missing / unknown field (400), unknown city (404)", async () => {
      const base = { base_minor: 100, per_km_minor: 100, min_minor: 100 };
      expect((await request(app).put(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops)).send({ ...base, base_minor: -1 })).status).toBe(400);
      expect((await request(app).put(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops)).send({ ...base, per_km_minor: 10.5 })).status).toBe(400);
      expect((await request(app).put(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops)).send({ base_minor: 100 })).status).toBe(400);
      expect((await request(app).put(`/api/rider-pay/rate-cards/${city}`).set(bearer(ops)).send({ ...base, surprise: 1 })).status).toBe(400);
      const nf = await request(app).put("/api/rider-pay/rate-cards/atlantis").set(bearer(ops)).send(base);
      expect(nf.status).toBe(404);
      expect((await request(app).get("/api/rider-pay/rate-cards/atlantis").set(bearer(ops))).status).toBe(404);
    });
    it("policy: GET empty, PUT saves, GET returns it; max below min is 400; unknown city 404", async () => {
      expect((await request(app).get(`/api/rider-pay/policies/${city}`).set(bearer(ops))).body.policy).toBeNull();
      const body = { withdraw_min_minor: 10000, withdraw_max_minor: 500000, withdraw_per_day: 2, default_cash_limit_minor: 200000, unavailable_wait_seconds: 600 };
      const put = await request(app).put(`/api/rider-pay/policies/${city}`).set(bearer(ops)).send(body);
      expect(put.status).toBe(200);
      expect(put.body.policy).toMatchObject(body);
      expect(put.body.currency_code).toBe("INR");
      expect((await request(app).get(`/api/rider-pay/policies/${city}`).set(bearer(ops))).body.policy).toMatchObject(body);
      const upd = await request(app).put(`/api/rider-pay/policies/${city}`).set(bearer(ops)).send({ ...body, withdraw_per_day: 3 });
      expect(upd.body.policy.withdraw_per_day).toBe(3);
      const inverted = await request(app).put(`/api/rider-pay/policies/${city}`).set(bearer(ops)).send({ ...body, withdraw_min_minor: 600000 });
      expect(inverted.status).toBe(400);
      expect((await request(app).put(`/api/rider-pay/policies/${city}`).set(bearer(ops)).send({ ...body, withdraw_per_day: 0 })).status).toBe(400);
      expect((await request(app).put("/api/rider-pay/policies/atlantis").set(bearer(ops)).send(body)).status).toBe(404);
      expect((await request(app).get("/api/rider-pay/policies/atlantis").set(bearer(ops))).status).toBe(404);
    });
  });

  // -------------------------------------------------------------- commission
  describe("commission rules", () => {
    let org: string;
    beforeAll(async () => {
      org = await createOrg({ status: "Active" });
      orgIds.push(org);
    });
    it("creates a rule, lists it, replaces it (old one stays as history), deactivates", async () => {
      const c = await request(app).post("/api/commission-rules").set(bearer(ops)).send({ organization_id: org, channel: "delivery", pct_bps: 1500, fixed_minor: 200, min_minor: 100, max_minor: 5000 });
      expect(c.status).toBe(201);
      const rule = c.body.rule;
      expect(rule).toMatchObject({ pct_bps: 1500, fixed_minor: 200, min_minor: 100, max_minor: 5000, active: true, currency_code: "INR" });
      const list = await request(app).get("/api/commission-rules").query({ organization_id: org }).set(bearer(ops));
      expect(list.body.rules.map((r: { id: string }) => r.id)).toContain(rule.id);
      const put = await request(app).put(`/api/commission-rules/${rule.id}`).set(bearer(ops)).send({ pct_bps: 1800, reason: "Renegotiated" });
      expect(put.status).toBe(200);
      expect(put.body.rule.pct_bps).toBe(1800);
      expect(put.body.rule.fixed_minor).toBe(200); // untouched fields carry over
      expect(put.body.rule.id).not.toBe(rule.id);
      expect(put.body.replaced_rule_id).toBe(rule.id);
      const hist = await request(app).get("/api/commission-rules").query({ organization_id: org, channel: "delivery" }).set(bearer(ops));
      expect(hist.body.rules).toHaveLength(2);
      expect(hist.body.rules.filter((r: { active: boolean }) => r.active)).toHaveLength(1);
      const oldRow = await query<{ pct_bps: number; active: boolean }>("SELECT pct_bps, active FROM commission_rules WHERE id = $1;", [rule.id]);
      expect(oldRow.rows[0]).toEqual({ pct_bps: 1500, active: false }); // history never rewritten
      const dea = await request(app).post(`/api/commission-rules/${put.body.rule.id}/deactivate`).set(bearer(ops)).send({ reason: "Contract ended" });
      expect(dea.status).toBe(200);
      expect(dea.body.rule.active).toBe(false);
      const act = await request(app).get("/api/commission-rules").query({ organization_id: org, active: "true" }).set(bearer(ops));
      expect(act.body.rules).toHaveLength(0);
      const audit = await query("SELECT actor_user_id FROM audit_logs WHERE action LIKE 'master.commission_rule_%' AND organization_id = $1;", [org]);
      expect(audit.rows.length).toBe(3);
      expect(audit.rows.every((x) => x.actor_user_id === ops.id)).toBe(true);
    });
    it("a second active rule for the same scope is refused (409) and an inactive rule cannot be replaced (409)", async () => {
      const mk = () => request(app).post("/api/commission-rules").set(bearer(sa)).send({ organization_id: org, channel: "pickup", pct_bps: 1000 });
      const first = await mk();
      expect(first.status).toBe(201);
      const dup = await mk();
      expect(dup.status).toBe(409);
      expect(dup.body.errorCode).toBe("master_rule_exists");
      await request(app).post(`/api/commission-rules/${first.body.rule.id}/deactivate`).set(bearer(sa)).send({});
      const rep = await request(app).put(`/api/commission-rules/${first.body.rule.id}`).set(bearer(sa)).send({ pct_bps: 900 });
      expect(rep.status).toBe(409);
    });
    it("validates figures: pct over 100%, negative amounts, max below min, unknown channel/org (400/404)", async () => {
      const post = (b: Record<string, unknown>) => request(app).post("/api/commission-rules").set(bearer(sa)).send(b);
      expect((await post({ pct_bps: 10001 })).status).toBe(400);
      expect((await post({ pct_bps: 100, fixed_minor: -5 })).status).toBe(400);
      expect((await post({ pct_bps: 100, min_minor: 500, max_minor: 100 })).status).toBe(400);
      expect((await post({ pct_bps: 100, channel: "carrier_pigeon" })).status).toBe(400);
      expect((await post({ pct_bps: 100.5 })).status).toBe(400);
      expect((await post({ channel: "online" })).status).toBe(400);
      const nf = await post({ organization_id: "00000000-0000-0000-0000-0000000000a4", pct_bps: 100 });
      expect(nf.status).toBe(404);
      expect((await request(app).put("/api/commission-rules/00000000-0000-0000-0000-0000000000a5").set(bearer(sa)).send({ pct_bps: 10 })).status).toBe(404);
      expect((await request(app).put("/api/commission-rules/00000000-0000-0000-0000-0000000000a5").set(bearer(sa)).send({})).status).toBe(400);
      expect((await request(app).post("/api/commission-rules/00000000-0000-0000-0000-0000000000a5/deactivate").set(bearer(sa)).send({})).status).toBe(404);
    });
    it("a platform-wide rule (no organization) can be created", async () => {
      const res = await request(app).post("/api/commission-rules").set(bearer(sa)).send({ channel: "swiggy", pct_bps: 2000 });
      expect([201, 409]).toContain(res.status); // 409 only if a previous run left the same scope active
      if (res.status === 201) {
        expect(res.body.rule.organization_id).toBeNull();
        await request(app).post(`/api/commission-rules/${res.body.rule.id}/deactivate`).set(bearer(sa)).send({});
      }
    });
  });
});
