import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, createOrg, cleanup, TestStaff } from "./helpers/testkit";
import { staffWith, bearer, seedOrder, seedRider, tag } from "./helpers/master-kit";

const today = () => new Date().toISOString().slice(0, 10);

describe("Master: finance control", () => {
  const staffIds: string[] = [];
  const roleKeys: string[] = [];
  const orgIds: string[] = [];
  const riderIds: string[] = [];
  let sa: TestStaff;
  let fin: TestStaff; // all finance actions, not super admin
  let viewer: TestStaff; // view only
  let org: string; // settled org (cleaned up)
  let keep: string; // org holding append-only rows (payments, ledgers): left behind in the disposable test DB

  beforeAll(async () => {
    sa = await createStaff({ roleKey: "super_admin" });
    fin = await staffWith({ feat_finance: "all" }, roleKeys);
    viewer = await staffWith({ feat_finance: ["view_finance"] }, roleKeys);
    staffIds.push(sa.id, fin.id, viewer.id);
    // settled organizations keep immutable settlements / payouts, so neither organization is deleted afterwards (disposable test DB)
    org = await createOrg({ status: "Active" });
    keep = await createOrg({ status: "Active" });
  });
  afterAll(async () => {
    await query("DELETE FROM riders WHERE id = ANY($1::uuid[]);", [riderIds]).catch(() => undefined);
    await cleanup({ orgIds, staffIds, roleKeys });
  });

  // ---------------------------------------------------------------- overview
  describe("GET /finance/overview", () => {
    it("returns collected / earned / owed / paid as minor units plus currency, with a per-currency breakdown", async () => {
      const o = await seedOrder(keep, { status: "new", total: 400 });
      await query(
        `INSERT INTO payment_ledger (organization_id, order_id, entry_type, direction, amount_minor, currency_code, gateway, idempotency_key) VALUES ($1, $2, 'capture', 'in', 40000, 'INR', 'razorpay', $3), ($1, $2, 'refund', 'out', 5000, 'INR', 'razorpay', $4);`,
        [keep, o, `cap-${tag()}`, `ref-${tag()}`]
      );
      const res = await request(app).get("/api/finance/overview").set(bearer(viewer));
      expect(res.status).toBe(200);
      const ov = res.body.overview;
      expect(ov.currency_code).toBe("INR");
      expect(ov.collected_minor).toBeGreaterThanOrEqual(40000);
      expect(ov.collected_net_minor).toBe(ov.collected_minor - ov.refunded_minor);
      for (const k of ["earned_minor", "owed_minor", "paid_minor", "rider_earned_minor", "by_currency"]) expect(ov).toHaveProperty(k);
    });
    it("rejects an inverted or oversized period (400)", async () => {
      const inv = await request(app).get("/api/finance/overview").query({ from: "2026-03-01", to: "2026-02-01" }).set(bearer(viewer));
      expect(inv.status).toBe(400);
      expect(inv.body.errorCode).toBe("master_bad_period");
      expect((await request(app).get("/api/finance/overview").query({ from: "2020-01-01", to: "2026-01-01" }).set(bearer(viewer))).status).toBe(400);
      expect((await request(app).get("/api/finance/overview").query({ from: "garbage" }).set(bearer(viewer))).status).toBe(400);
    });
  });

  // ------------------------------------------- settlements and payouts flow
  describe("settlement run -> approve -> payout approve -> mark paid", () => {
    let settlementId: string;
    let payoutId: string;

    beforeAll(async () => {
      await seedOrder(org, { status: "paid", total: 300 });
      await query("UPDATE orders SET paid_at = now() WHERE organization_id = $1;", [org]).catch(() => undefined);
    });

    it("runs a settlement for the period (201, draft, minor units + currency), attributed to a non-super finance user", async () => {
      const res = await request(app).post("/api/finance/settlements/run").set(bearer(fin)).send({ organization_id: org, period_start: today(), period_end: today() });
      expect(res.status).toBe(201);
      settlementId = res.body.settlement.id;
      expect(res.body.settlement).toMatchObject({ status: "draft", currency_code: "INR", organization_id: org });
      expect(res.body.settlement.gross_minor).toBe(30000);
      const audit = await query("SELECT actor_user_id FROM audit_logs WHERE action = 'master.settlement_run' AND entity_id = $1;", [settlementId]);
      expect(audit.rows[0].actor_user_id).toBe(fin.id);
    });
    it("a second run for the same period is refused (409 finance_exists)", async () => {
      const res = await request(app).post("/api/finance/settlements/run").set(bearer(sa)).send({ organization_id: org, period_start: today(), period_end: today() });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe("finance_exists");
    });
    it("validates the run payload: dates, order, unknown organization", async () => {
      const post = (b: Record<string, unknown>) => request(app).post("/api/finance/settlements/run").set(bearer(sa)).send(b);
      expect((await post({ organization_id: org, period_start: "2026-02-01", period_end: "2026-01-01" })).status).toBe(400);
      expect((await post({ organization_id: org, period_start: "01/02/2026", period_end: "2026-02-02" })).status).toBe(400);
      expect((await post({ period_start: today(), period_end: today() })).status).toBe(400);
      expect((await post({ organization_id: "00000000-0000-0000-0000-0000000000c1", period_start: today(), period_end: today() })).status).toBe(404);
    });
    it("lists settlements with filters and shows the draft", async () => {
      const res = await request(app).get("/api/finance/settlements").query({ org, status: "draft" }).set(bearer(viewer));
      expect(res.status).toBe(200);
      expect(res.body.settlements.map((s: { id: string }) => s.id)).toContain(settlementId);
      expect(res.body.settlements[0]).toMatchObject({ currency_code: "INR", organization_name: expect.any(String) });
      expect((await request(app).get("/api/finance/settlements").query({ status: "nope" }).set(bearer(viewer))).status).toBe(400);
    });
    it("approves the settlement (creates the merchant payout) and a repeat is 409", async () => {
      const res = await request(app).post(`/api/finance/settlements/${settlementId}/approve`).set(bearer(fin));
      expect(res.status).toBe(200);
      expect(res.body.settlement.status).toBe("approved");
      payoutId = res.body.payout_id;
      expect(payoutId).toBeTruthy();
      const again = await request(app).post(`/api/finance/settlements/${settlementId}/approve`).set(bearer(fin));
      expect(again.status).toBe(409);
      expect(again.body.errorCode).toBe("finance_wrong_state");
      expect((await request(app).post("/api/finance/settlements/00000000-0000-0000-0000-0000000000c2/approve").set(bearer(fin))).status).toBe(404);
    });
    it("lists payouts by status with money in minor units", async () => {
      const res = await request(app).get("/api/finance/payouts").query({ org, status: "pending", payee_type: "merchant" }).set(bearer(viewer));
      expect(res.status).toBe(200);
      expect(res.body.payouts[0]).toMatchObject({ id: payoutId, amount_minor: 30000, currency_code: "INR", status: "pending", payee_type: "merchant" });
      expect((await request(app).get("/api/finance/payouts").query({ payee_type: "alien" }).set(bearer(viewer))).status).toBe(400);
    });
    it("mark-paid before approval is 409; approve works once; mark-paid needs a reference then completes the settlement", async () => {
      const early = await request(app).post(`/api/finance/payouts/${payoutId}/mark-paid`).set(bearer(fin)).send({ reference: "UTR-0001" });
      expect(early.status).toBe(409);
      const ap = await request(app).post(`/api/finance/payouts/${payoutId}/approve`).set(bearer(fin));
      expect(ap.status).toBe(200);
      expect(ap.body.payout.status).toBe("approved");
      expect((await request(app).post(`/api/finance/payouts/${payoutId}/approve`).set(bearer(fin))).status).toBe(409);
      expect((await request(app).post(`/api/finance/payouts/${payoutId}/mark-paid`).set(bearer(fin)).send({})).status).toBe(400);
      expect((await request(app).post(`/api/finance/payouts/${payoutId}/mark-paid`).set(bearer(fin)).send({ reference: "x" })).status).toBe(400);
      const paid = await request(app).post(`/api/finance/payouts/${payoutId}/mark-paid`).set(bearer(fin)).send({ reference: "UTR-0001" });
      expect(paid.status).toBe(200);
      expect(paid.body.payout).toMatchObject({ status: "paid", reference: "UTR-0001" });
      const s = await query<{ status: string }>("SELECT status FROM settlements WHERE id = $1;", [settlementId]);
      expect(s.rows[0].status).toBe("paid");
      const audit = await query("SELECT actor_user_id FROM audit_logs WHERE entity_type = 'payouts' AND entity_id = $1 AND actor_user_id IS NOT NULL;", [payoutId]);
      expect(audit.rows.length).toBeGreaterThanOrEqual(2);
      expect(audit.rows.every((r) => r.actor_user_id === fin.id)).toBe(true);
      expect((await request(app).post(`/api/finance/payouts/${payoutId}/mark-paid`).set(bearer(fin)).send({ reference: "UTR-0002" })).status).toBe(409);
    });
    it("unknown payouts are 404", async () => {
      expect((await request(app).post("/api/finance/payouts/00000000-0000-0000-0000-0000000000c3/approve").set(bearer(fin))).status).toBe(404);
      expect((await request(app).post("/api/finance/payouts/00000000-0000-0000-0000-0000000000c3/mark-paid").set(bearer(fin)).send({ reference: "UTR-9999" })).status).toBe(404);
    });
  });

  // -------------------------------------------------------------- read models
  describe("GET /finance/payments, /ledger, /reconciliation, /rider-earnings", () => {
    it("payments: filters by org, method and period, minor units + currency", async () => {
      const o = await seedOrder(keep, { status: "new", total: 150 });
      await query("INSERT INTO payments (organization_id, order_id, method, amount, reference) VALUES ($1, $2, 'upi', 150, $3);", [keep, o, `ref-${tag()}`]);
      const res = await request(app).get("/api/finance/payments").query({ org: keep, method: "upi" }).set(bearer(viewer));
      expect(res.status).toBe(200);
      expect(res.body.payments[0]).toMatchObject({ order_id: o, method: "upi", amount_minor: 15000, currency_code: "INR" });
      expect((await request(app).get("/api/finance/payments").query({ org: keep, method: "cash" }).set(bearer(viewer))).body.payments).toHaveLength(0);
      expect((await request(app).get("/api/finance/payments").query({ from: "2100-01-01" }).set(bearer(viewer))).body.payments).toHaveLength(0);
      expect((await request(app).get("/api/finance/payments").query({ org: "bad" }).set(bearer(viewer))).status).toBe(400);
    });
    it("ledger: unions commission and payment entries, filters by order and type, paginates", async () => {
      const o = await seedOrder(keep, { status: "new", total: 100 });
      await query(`INSERT INTO payment_ledger (organization_id, order_id, entry_type, direction, amount_minor, currency_code, gateway, idempotency_key) VALUES ($1, $2, 'capture', 'in', 10000, 'INR', 'razorpay', $3);`, [keep, o, `led-${tag()}`]);
      await query(`INSERT INTO commission_ledger (organization_id, order_id, entry_type, party_type, amount_minor, currency_code) VALUES ($1, $2, 'accrual', 'platform', 1500, 'INR');`, [keep, o]);
      const res = await request(app).get("/api/finance/ledger").query({ order_id: o }).set(bearer(viewer));
      expect(res.status).toBe(200);
      expect(res.body.entries.map((e: { source: string }) => e.source).sort()).toEqual(["commission", "payment"]);
      expect(res.body.entries.every((e: { currency_code: string }) => e.currency_code === "INR")).toBe(true);
      const one = await request(app).get("/api/finance/ledger").query({ order_id: o, type: "capture" }).set(bearer(viewer));
      expect(one.body.entries).toHaveLength(1);
      expect(one.body.entries[0]).toMatchObject({ source: "payment", amount_minor: 10000 });
      const p = await request(app).get("/api/finance/ledger").query({ order_id: o, limit: 1, page: 2 }).set(bearer(viewer));
      expect(p.body.entries).toHaveLength(1);
      expect(p.body.pagination).toMatchObject({ total: 2, totalPages: 2 });
      expect((await request(app).get("/api/finance/ledger").query({ source: "mystery" }).set(bearer(viewer))).status).toBe(400);
      expect((await request(app).get("/api/finance/ledger").query({ order_id: "x" }).set(bearer(viewer))).status).toBe(400);
    });
    it("reconciliation: totals plus open payment exceptions and invariant violations", async () => {
      await query(`INSERT INTO payment_reconciliation_exceptions (organization_id, kind, ref_key, expected_minor, actual_minor, status) VALUES ($1, 'amount_mismatch', $2, 100, 90, 'open');`, [keep, `rk-${tag()}`]);
      const res = await request(app).get("/api/finance/reconciliation").set(bearer(viewer));
      expect(res.status).toBe(200);
      for (const k of ["open_payment_exceptions", "open_invariant_violations", "draft_settlements", "open_payouts"]) expect(res.body.totals).toHaveProperty(k);
      expect(res.body.totals.open_payment_exceptions).toBeGreaterThanOrEqual(1);
      expect(res.body.payment_exceptions.some((e: { organization_id: string; expected_minor: number }) => e.organization_id === keep && e.expected_minor === 100)).toBe(true);
      expect(Array.isArray(res.body.invariant_violations)).toBe(true);
    });
    it("rider earnings: aggregates per rider with earned / unpaid / paid, filters by rider and period", async () => {
      const rid = await seedRider({ status: "approved", city: "latur" });
      riderIds.push(rid);
      await query(`INSERT INTO rider_earnings (rider_id, kind, amount_minor, currency_code) VALUES ($1, 'delivery_fee', 4000, 'INR'), ($1, 'tip', 1000, 'INR');`, [rid]).catch(() => undefined);
      const res = await request(app).get("/api/finance/rider-earnings").query({ rider_id: rid }).set(bearer(viewer));
      expect(res.status).toBe(200);
      expect(res.body.rider_earnings).toHaveLength(1);
      expect(res.body.rider_earnings[0]).toMatchObject({ rider_id: rid, earned_minor: 5000, unpaid_minor: 5000, paid_minor: 0, currency_code: "INR", entries: 2 });
      expect((await request(app).get("/api/finance/rider-earnings").query({ rider_id: rid, from: "2100-01-01" }).set(bearer(viewer))).body.rider_earnings).toHaveLength(0);
      expect((await request(app).get("/api/finance/rider-earnings").query({ to: "never" }).set(bearer(viewer))).status).toBe(400);
    });
  });
});
