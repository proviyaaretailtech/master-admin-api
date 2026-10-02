import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, createOrg, cleanup } from "./helpers/testkit";

describe("Organizations API Integration Tests", () => {
  const orgIds: string[] = [];
  const staffIds: string[] = [];
  let token: string;
  const tag = Date.now().toString(36);
  const phone = (n: number) => `+9188${String(n).padStart(2, "0")}${tag.replace(/\D/g, "").padEnd(6, "1").slice(0, 6)}`;
  const body = (n: number, extra: Record<string, unknown> = {}) => ({
    business_name: `OrgTest ${tag} ${n}`,
    domain: "Restaurant",
    email: `orgtest-${tag}-${n}@test.local`,
    phone_number: phone(n),
    ...extra,
  });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    const sa = await createStaff({ roleKey: "super_admin" });
    staffIds.push(sa.id);
    token = sa.token;
  });

  afterAll(async () => {
    await query("DELETE FROM orders WHERE organization_id = ANY($1::uuid[]);", [orgIds]);
    await cleanup({ orgIds, staffIds });
  });

  describe("create", () => {
    it("POST /api/organizations creates an org (201) with a default location and Draft -> onboarding", async () => {
      const res = await request(app).post("/api/organizations").set(auth()).send(body(1));
      expect(res.status).toBe(201);
      const org = res.body.organization;
      orgIds.push(org.id);
      expect(org.business_name).toBe(`OrgTest ${tag} 1`);
      expect(org.status).toBe("Draft");
      expect(org.email).toBe(`orgtest-${tag}-1@test.local`);

      const row = await query<{ status: string; control_status: string }>(
        "SELECT status::text AS status, control_status FROM organizations WHERE id = $1;",
        [org.id]
      );
      expect(row.rows[0].status).toBe("onboarding");
      expect(row.rows[0].control_status).toBe("Draft");

      const locs = await query<{ n: number }>("SELECT count(*)::int AS n FROM locations WHERE organization_id = $1;", [org.id]);
      expect(locs.rows[0].n).toBe(1);
    });

    it("maps status Active -> canonical 'active'", async () => {
      const res = await request(app).post("/api/organizations").set(auth()).send(body(2, { status: "Active" }));
      expect(res.status).toBe(201);
      orgIds.push(res.body.organization.id);
      expect(res.body.organization.status).toBe("Active");
      const row = await query<{ status: string }>("SELECT status::text AS status FROM organizations WHERE id = $1;", [
        res.body.organization.id,
      ]);
      expect(row.rows[0].status).toBe("active");
    });

    it("rejects a duplicate email with 400", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set(auth())
        .send({ ...body(3), email: `orgtest-${tag}-1@test.local` });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/email/i);
    });

    it("rejects a duplicate phone number with 400", async () => {
      const res = await request(app)
        .post("/api/organizations")
        .set(auth())
        .send({ ...body(4), phone_number: phone(1) });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/phone/i);
    });

    it("rejects an invalid payload with 400", async () => {
      const res = await request(app).post("/api/organizations").set(auth()).send({ business_name: "x" });
      expect(res.status).toBe(400);
    });

    it("rejects missing token with 401", async () => {
      const res = await request(app).post("/api/organizations").send(body(5));
      expect(res.status).toBe(401);
    });
  });

  describe("list, filters and pagination", () => {
    beforeAll(async () => {
      const res = await request(app).post("/api/organizations").set(auth()).send(body(6, { domain: "Retail", status: "Pending" }));
      expect(res.status).toBe(201);
      orgIds.push(res.body.organization.id);
    });

    it("searches by name", async () => {
      const res = await request(app).get("/api/organizations").set(auth()).query({ search: `OrgTest ${tag}` });
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(3);
    });

    it("filters by status", async () => {
      const res = await request(app).get("/api/organizations").set(auth()).query({ search: `OrgTest ${tag}`, status: "Active" });
      expect(res.status).toBe(200);
      expect(res.body.organizations).toHaveLength(1);
      expect(res.body.organizations[0].status).toBe("Active");
    });

    it("filters by domain", async () => {
      const res = await request(app).get("/api/organizations").set(auth()).query({ search: `OrgTest ${tag}`, domain: "Retail" });
      expect(res.status).toBe(200);
      expect(res.body.organizations).toHaveLength(1);
      expect(res.body.organizations[0].domain).toBe("Retail");
    });

    it("paginates results", async () => {
      const p1 = await request(app)
        .get("/api/organizations")
        .set(auth())
        .query({ search: `OrgTest ${tag}`, limit: 2, page: 1, sortBy: "business_name", sortOrder: "asc" });
      const p2 = await request(app)
        .get("/api/organizations")
        .set(auth())
        .query({ search: `OrgTest ${tag}`, limit: 2, page: 2, sortBy: "business_name", sortOrder: "asc" });
      expect(p1.body.organizations).toHaveLength(2);
      expect(p2.body.organizations).toHaveLength(1);
      expect(p1.body.pagination).toMatchObject({ total: 3, page: 1, limit: 2, totalPages: 2 });
      expect(p1.body.organizations[0].business_name).toBe(`OrgTest ${tag} 1`);
      expect(p2.body.organizations[0].business_name).toBe(`OrgTest ${tag} 6`);
    });
  });

  describe("update", () => {
    it("PUT /api/organizations/:id updates fields and syncs canonical status", async () => {
      const res = await request(app)
        .put(`/api/organizations/${orgIds[0]}`)
        .set(auth())
        .send({ business_name: `OrgTest ${tag} 1 Renamed`, status: "Approved" });
      expect(res.status).toBe(200);
      expect(res.body.organization.business_name).toBe(`OrgTest ${tag} 1 Renamed`);
      expect(res.body.organization.status).toBe("Approved");
      const row = await query<{ status: string }>("SELECT status::text AS status FROM organizations WHERE id = $1;", [orgIds[0]]);
      expect(row.rows[0].status).toBe("active");
    });

    it("rejects an email already used by another org (400)", async () => {
      const res = await request(app)
        .put(`/api/organizations/${orgIds[0]}`)
        .set(auth())
        .send({ email: `orgtest-${tag}-2@test.local` });
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown org", async () => {
      const res = await request(app)
        .put("/api/organizations/00000000-0000-0000-0000-000000000000")
        .set(auth())
        .send({ business_name: "Does Not Exist" });
      expect(res.status).toBe(404);
    });
  });

  describe("delete", () => {
    it("deletes an organization with no orders (200)", async () => {
      const id = await createOrg();
      const res = await request(app).delete(`/api/organizations/${id}`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.deletedId).toBe(id);
      const row = await query("SELECT 1 FROM organizations WHERE id = $1;", [id]);
      expect(row.rows).toHaveLength(0);
    });

    it("refuses to delete an organization that has an order (400)", async () => {
      const id = await createOrg();
      orgIds.push(id);
      await query(
        `INSERT INTO orders (organization_id, order_no, display_no, status) VALUES ($1, $2, $3, 'new');`,
        [id, 1, `T-${tag}`]
      );
      const res = await request(app).delete(`/api/organizations/${id}`).set(auth());
      expect(res.status).toBe(400);
      const row = await query("SELECT 1 FROM organizations WHERE id = $1;", [id]);
      expect(row.rows).toHaveLength(1);
    });
  });
});
