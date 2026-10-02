/**
 * MA-4: `status` (and the add-on verification statuses) must not be mass-assignable through the edit
 * permission. Publishing and retiring plans, packs and add-ons needs the publish_* / retire_* action; editing
 * a Published item (live terms for every subscriber) needs the publish action too.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { ensureRole, createStaff, cleanup, permString } from "./helpers/testkit";

const roleKeys = ["cl_editor", "cl_publisher", "cl_retirer"];

type Kind = {
  name: string;
  base: string;
  table: string;
  codeCol: string;
  feature: string;
  editorActions: string[];
  publisherActions: string[];
  retirerActions: string[];
  body: (code: string) => Record<string, unknown>;
  key: "plan" | "pack" | "addon";
};

const KINDS: Kind[] = [
  {
    name: "plans",
    base: "/api/commercials/plans",
    table: "commercial_plans",
    codeCol: "plan_code",
    feature: "feat_commercial_plans",
    editorActions: ["view_plans", "create_plan", "edit_plan"],
    publisherActions: ["view_plans", "create_plan", "edit_plan", "publish_plan"],
    retirerActions: ["view_plans", "create_plan", "edit_plan", "retire_plan"],
    body: (code) => ({ name: `Lifecycle ${code}`, plan_code: code, price: 1000, modules: [] }),
    key: "plan",
  },
  {
    name: "packs",
    base: "/api/commercials/packs",
    table: "commercial_packs",
    codeCol: "pack_code",
    feature: "feat_commercial_packs",
    editorActions: ["view_packs", "create_pack", "edit_pack"],
    publisherActions: ["view_packs", "create_pack", "edit_pack", "publish_pack"],
    retirerActions: ["view_packs", "create_pack", "edit_pack", "retire_pack"],
    body: (code) => ({ name: `Lifecycle ${code}`, pack_code: code, price: 500 }),
    key: "pack",
  },
  {
    name: "add-ons",
    base: "/api/commercials/add-ons",
    table: "commercial_addons",
    codeCol: "addon_code",
    feature: "feat_commercial_addons",
    editorActions: ["view_addons", "create_addon", "edit_addon"],
    publisherActions: ["view_addons", "create_addon", "edit_addon", "publish_addon"],
    retirerActions: ["view_addons", "create_addon", "edit_addon", "retire_addon"],
    body: (code) => ({ name: `Lifecycle ${code}`, addon_code: code, category: "Ops", price: 200 }),
    key: "addon",
  },
];

describe("MA-4 publishing and retiring need their own permission, not edit", () => {
  const staffIds: string[] = [];
  let editor: Awaited<ReturnType<typeof createStaff>>;
  let publisher: Awaited<ReturnType<typeof createStaff>>;
  let retirer: Awaited<ReturnType<typeof createStaff>>;
  let superAdmin: Awaited<ReturnType<typeof createStaff>>;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = Date.now().toString(36);

  beforeAll(async () => {
    const spec = (pick: (k: Kind) => string[]) =>
      permString(Object.fromEntries(KINDS.map((k) => [k.feature, pick(k)])));
    await ensureRole({ key: "cl_editor", permissions: spec((k) => k.editorActions) });
    await ensureRole({ key: "cl_publisher", permissions: spec((k) => k.publisherActions) });
    await ensureRole({ key: "cl_retirer", permissions: spec((k) => k.retirerActions) });
    editor = await createStaff({ roleKey: "cl_editor" });
    publisher = await createStaff({ roleKey: "cl_publisher" });
    retirer = await createStaff({ roleKey: "cl_retirer" });
    superAdmin = await createStaff({ roleKey: "super_admin" });
    staffIds.push(editor.id, publisher.id, retirer.id, superAdmin.id);
  });

  afterAll(async () => {
    for (const k of KINDS) await query(`DELETE FROM ${k.table} WHERE ${k.codeCol} LIKE 'cl_${stamp}%';`);
    await cleanup({ staffIds, roleKeys });
  });

  const statusOf = async (k: Kind, id: string) =>
    (await query<{ status: string }>(`SELECT status FROM ${k.table} WHERE id = $1;`, [id])).rows[0]?.status;

  for (const k of KINDS) {
    describe(k.name, () => {
      const code = (suffix: string) => `cl_${stamp}_${k.key}_${suffix}`;
      const bodyOf = (res: request.Response) => res.body[k.key];

      it("create_* alone cannot create an item that is already Published or Retired (403, nothing created)", async () => {
        for (const status of ["Published", "Retired"]) {
          const c = code(`create_${status.toLowerCase()}`);
          const res = await request(app).post(k.base).set(auth(editor.token)).send({ ...k.body(c), status });
          expect(res.status, status).toBe(403);
          const exists = await query(`SELECT 1 FROM ${k.table} WHERE ${k.codeCol} = $1;`, [c]);
          expect(exists.rows.length).toBe(0);
        }
      });

      it("create_* creates a Draft, including when the editor UI sends status Draft explicitly (201)", async () => {
        const res = await request(app).post(k.base).set(auth(editor.token)).send({ ...k.body(code("draft")), status: "Draft" });
        expect(res.status).toBe(201);
        expect(bodyOf(res).status).toBe("Draft");
      });

      it("edit_* cannot publish through the update endpoint by sending status (403, still Draft)", async () => {
        const created = await request(app).post(k.base).set(auth(editor.token)).send(k.body(code("edit_pub")));
        const id = bodyOf(created).id;
        for (const method of ["put", "patch"] as const) {
          const res = await request(app)[method](`${k.base}/${id}`).set(auth(editor.token)).send({ status: "Published", price: 0 });
          expect(res.status, method).toBe(403);
        }
        expect(await statusOf(k, id)).toBe("Draft");
        const price = await query<{ price: string }>(`SELECT price FROM ${k.table} WHERE id = $1;`, [id]);
        expect(Number(price.rows[0].price)).not.toBe(0); // the re-pricing riding along was not applied either
      });

      it("edit_* can still edit a Draft (200) and the status stays Draft when the UI resends status Draft", async () => {
        const created = await request(app).post(k.base).set(auth(editor.token)).send(k.body(code("edit_draft")));
        const id = bodyOf(created).id;
        const res = await request(app).put(`${k.base}/${id}`).set(auth(editor.token)).send({ name: "Edited draft", status: "Draft", price: 1234 });
        expect(res.status).toBe(200);
        expect(bodyOf(res).name).toBe("Edited draft");
        expect(Number(bodyOf(res).price)).toBe(1234);
        expect(bodyOf(res).status).toBe("Draft");
      });

      it("publish_* publishes via the update endpoint too (200) and via the dedicated endpoint; edit-only is refused on that endpoint", async () => {
        const created = await request(app).post(k.base).set(auth(publisher.token)).send(k.body(code("pub_ok")));
        const id = bodyOf(created).id;
        const viaUpdate = await request(app).put(`${k.base}/${id}`).set(auth(publisher.token)).send({ status: "Published" });
        expect(viaUpdate.status).toBe(200);
        expect(bodyOf(viaUpdate).status).toBe("Published");

        const created2 = await request(app).post(k.base).set(auth(editor.token)).send(k.body(code("pub_ep")));
        const id2 = bodyOf(created2).id;
        expect((await request(app).post(`${k.base}/${id2}/publish`).set(auth(editor.token))).status).toBe(403);
        expect((await request(app).post(`${k.base}/${id2}/publish`).set(auth(publisher.token))).status).toBe(200);
      });

      it("publish_* can create an item directly as Published (the editor's create-and-publish flow) (201)", async () => {
        const res = await request(app).post(k.base).set(auth(publisher.token)).send({ ...k.body(code("direct_pub")), status: "Published" });
        expect(res.status).toBe(201);
        expect(bodyOf(res).status).toBe("Published");
      });

      it("a Published item's live terms cannot be edited with edit_* alone (403, unchanged); publish_* can (200)", async () => {
        const created = await request(app).post(k.base).set(auth(publisher.token)).send({ ...k.body(code("live")), status: "Published" });
        const id = bodyOf(created).id;
        const before = await query<{ price: string }>(`SELECT price FROM ${k.table} WHERE id = $1;`, [id]);

        const denied = await request(app).put(`${k.base}/${id}`).set(auth(editor.token)).send({ price: 0 });
        expect(denied.status).toBe(403);
        const after = await query<{ price: string }>(`SELECT price FROM ${k.table} WHERE id = $1;`, [id]);
        expect(after.rows[0].price).toBe(before.rows[0].price);

        const allowed = await request(app).put(`${k.base}/${id}`).set(auth(publisher.token)).send({ price: 777 });
        expect(allowed.status).toBe(200);
        expect(Number(bodyOf(allowed).price)).toBe(777);
        expect(bodyOf(allowed).status).toBe("Published"); // an update never moves a Published item back to Draft
      });

      it("a Published item stays Published when the editor UI saves it with status Draft (publish_* holder)", async () => {
        const created = await request(app).post(k.base).set(auth(publisher.token)).send({ ...k.body(code("keep")), status: "Published" });
        const id = bodyOf(created).id;
        const res = await request(app).put(`${k.base}/${id}`).set(auth(publisher.token)).send({ name: "Renamed live", status: "Draft" });
        expect(res.status).toBe(200);
        expect(await statusOf(k, id)).toBe("Published");
      });

      it("edit_* cannot retire by sending status (403); retire_* can, via update and via the dedicated endpoint", async () => {
        const created = await request(app).post(k.base).set(auth(publisher.token)).send({ ...k.body(code("retire")), status: "Published" });
        const id = bodyOf(created).id;

        const denied = await request(app).put(`${k.base}/${id}`).set(auth(editor.token)).send({ status: "Retired" });
        expect(denied.status).toBe(403);
        expect((await request(app).post(`${k.base}/${id}/retire`).set(auth(editor.token))).status).toBe(403);
        expect(await statusOf(k, id)).toBe("Published");

        // a retire-only holder lacks publish_*, so the live-edit gate also stops a Published item being edited by them
        const viaUpdate = await request(app).put(`${k.base}/${id}`).set(auth(superAdmin.token)).send({ status: "Retired" });
        expect(viaUpdate.status).toBe(200);
        expect(bodyOf(viaUpdate).status).toBe("Retired");
        if (k.key === "plan") expect(bodyOf(viaUpdate).version_type).toBe("Legacy");
      });

      it("retire_* retires a Published item through the dedicated endpoint (200)", async () => {
        const created = await request(app).post(k.base).set(auth(publisher.token)).send({ ...k.body(code("retire2")), status: "Published" });
        const id = bodyOf(created).id;
        const res = await request(app).post(`${k.base}/${id}/retire`).set(auth(retirer.token));
        expect(res.status).toBe(200);
        expect(await statusOf(k, id)).toBe("Retired");
      });

      it("rejects out-of-range or malformed values with 400 (negative or infinite price, bad currency, bad date)", async () => {
        const bad: Array<Record<string, unknown>> = [
          { price: -1 },
          { price: "Infinity" },
          { price: 1e15 },
          { currency: "rupees" },
          { effective_date: "not-a-date" },
        ];
        for (const [i, extra] of bad.entries()) {
          const res = await request(app).post(k.base).set(auth(editor.token)).send({ ...k.body(code(`bad${i}`)), ...extra });
          expect(res.status, JSON.stringify(extra)).toBe(400);
        }
      });
    });
  }

  describe("audit trail", () => {
    it("attributes publishing to the staff member who did it", async () => {
      const created = await request(app).post("/api/commercials/plans").set(auth(publisher.token)).send({ name: "Audited", plan_code: `cl_${stamp}_audit`, price: 1 });
      const id = created.body.plan.id;
      expect((await request(app).post(`/api/commercials/plans/${id}/publish`).set(auth(publisher.token))).status).toBe(200);
      const audit = await query<{ actor_user_id: string }>(
        `SELECT actor_user_id FROM audit_logs WHERE entity_type = 'commercial_plans' AND entity_id = $1 AND action = 'commercial_plans.update' ORDER BY id DESC LIMIT 1;`,
        [id]
      );
      expect(audit.rows[0]?.actor_user_id).toBe(publisher.id);
    });
  });

  describe("plans: version_type follows the lifecycle", () => {
    it("ignores a client-sent version_type Active/Legacy on a Draft plan and derives it from the status", async () => {
      const res = await request(app)
        .post("/api/commercials/plans")
        .set(auth(editor.token))
        .send({ name: "VT", plan_code: `cl_${stamp}_vt`, version_type: "Active", status: "Draft", price: 1 });
      expect(res.status).toBe(201);
      expect(res.body.plan.version_type).toBe("Draft");
    });

    it("sets version_type Active when a publisher creates the plan Published, as the editor UI expects", async () => {
      const res = await request(app)
        .post("/api/commercials/plans")
        .set(auth(publisher.token))
        .send({ name: "VT2", plan_code: `cl_${stamp}_vt2`, version_type: "Active", status: "Published", price: 1 });
      expect(res.status).toBe(201);
      expect(res.body.plan.status).toBe("Published");
      expect(res.body.plan.version_type).toBe("Active");
    });
  });

  describe("add-ons: system-managed verification statuses", () => {
    it("ignores billing_sync_status / entitlement_validation_status / tax_compliance_status on create and update", async () => {
      const forged = { billing_sync_status: "FORGED", entitlement_validation_status: "FORGED", tax_compliance_status: "Verified" };
      const created = await request(app)
        .post("/api/commercials/add-ons")
        .set(auth(editor.token))
        .send({ name: "Sys Status", addon_code: `cl_${stamp}_sys`, category: "Ops", ...forged });
      expect(created.status).toBe(201);
      expect(created.body.addon.billing_sync_status).toBe("Success");
      expect(created.body.addon.entitlement_validation_status).toBe("Passed");
      expect(created.body.addon.tax_compliance_status).toBe("Pending verification");

      const updated = await request(app).put(`/api/commercials/add-ons/${created.body.addon.id}`).set(auth(editor.token)).send({ ...forged, description: "x" });
      expect(updated.status).toBe(200);
      expect(updated.body.addon.billing_sync_status).toBe("Success");
      expect(updated.body.addon.tax_compliance_status).toBe("Pending verification");
    });

    it("rejects a maximum quantity below the minimum with 400 instead of a database error", async () => {
      const res = await request(app)
        .post("/api/commercials/add-ons")
        .set(auth(editor.token))
        .send({ name: "Qty", addon_code: `cl_${stamp}_qty`, category: "Ops", min_quantity: 5, max_quantity: 2 });
      expect(res.status).toBe(400);
    });
  });
});
