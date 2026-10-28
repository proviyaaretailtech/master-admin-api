import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import app from "../index";
import { TEST_INTERNAL_KEYS } from "./helpers/internal-keys";
import { identifyCaller, internalKeysFromEnv } from "../config/internal-keys.config";
import { rejectedInternalKeyCount, requireInternalKey } from "../middlewares/internal-key.middleware";

describe("Master server: only our own servers may call it", () => {
  it("liveness stays open without a key", async () => {
    const res = await request(app).get("/api/health").unset("x-internal-key");
    expect(res.status).toBe(200);
  });

  it("refuses a request with no key, giving nothing away", async () => {
    for (const path of ["/", "/api/me/context", "/api/internal/whoami", "/api/does-not-exist"]) {
      const res = await request(app).get(path).unset("x-internal-key");
      expect(res.status, path).toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/INTERNAL_KEY|admin-frontend|customer/);
    }
  });

  it("refuses a wrong key", async () => {
    const res = await request(app).get("/api/me/context").set("x-internal-key", "x".repeat(64));
    expect(res.status).toBe(401);
  });

  it("staff routes accept only the Master Admin panel's proxy", async () => {
    for (const caller of ["customer", "partner", "rider", "pos"] as const) {
      const res = await request(app).get("/api/me/context").set("x-internal-key", TEST_INTERNAL_KEYS[caller]);
      expect(res.status, caller).toBe(403);
    }
    // admin-frontend passes the gate and reaches the staff sign-in check.
    const res = await request(app).get("/api/me/context");
    expect(res.status).toBe(401);
  });

  it("internal routes accept the app servers and name the caller, not the panel", async () => {
    for (const caller of ["customer", "partner", "rider", "pos"] as const) {
      const res = await request(app).get("/api/internal/whoami").set("x-internal-key", TEST_INTERNAL_KEYS[caller]);
      expect(res.status, caller).toBe(200);
      expect(res.body).toEqual({ caller });
    }
    const res = await request(app).get("/api/internal/whoami");
    expect(res.status).toBe(403);
  });
});

describe("internal keys", () => {
  it("ignores unset and too-short keys and tells callers apart", () => {
    const keys = internalKeysFromEnv({
      INTERNAL_KEY_ADMIN_FRONTEND: "a".repeat(40),
      INTERNAL_KEY_CUSTOMER: "short",
      INTERNAL_KEY_RIDER: "r".repeat(32),
    });
    expect(keys.map((k) => k.caller)).toEqual(["admin-frontend", "rider"]);
    expect(identifyCaller("a".repeat(40), keys)).toBe("admin-frontend");
    expect(identifyCaller("r".repeat(32), keys)).toBe("rider");
    expect(identifyCaller("short", keys)).toBeNull();
    expect(identifyCaller(undefined, keys)).toBeNull();
    expect(identifyCaller("z".repeat(600), keys)).toBeNull();
  });

  it("trusts the forwarded client IP only on a request with a valid key", async () => {
    const keys = internalKeysFromEnv({ INTERNAL_KEY_ADMIN_FRONTEND: "k".repeat(40) });
    const probe = express();
    probe.use(requireInternalKey({ openPaths: ["/open"], keys }));
    probe.get(["/ip", "/open"], (req, res) => res.json({ ip: req.ip }));
    probe.use((err: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(err.statusCode ?? 500).end()
    );

    const withKey = await request(probe).get("/ip").set("x-internal-key", "k".repeat(40)).set("x-client-ip", "203.0.113.7");
    expect(withKey.body.ip).toBe("203.0.113.7");

    const notAnIp = await request(probe).get("/ip").set("x-internal-key", "k".repeat(40)).set("x-client-ip", "evil");
    expect(notAnIp.body.ip).not.toBe("evil");

    const open = await request(probe).get("/open").unset("x-internal-key").set("x-client-ip", "203.0.113.7");
    expect(open.body.ip).not.toBe("203.0.113.7");
  });

  describe("rotation: the current key and the _NEXT key are the same caller", () => {
    const current = "c".repeat(40);
    const next = "n".repeat(40);

    function probeWith(env: NodeJS.ProcessEnv, lines: string[] = []) {
      const probe = express();
      probe.use(requireInternalKey({ openPaths: [], keys: internalKeysFromEnv(env), log: (l) => lines.push(l) }));
      probe.get("/whoami", (req, res) => res.json({ caller: req.internalCaller }));
      probe.use((err: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
        res.status(err.statusCode ?? 500).end()
      );
      return probe;
    }

    it("accepts the current key alone", async () => {
      const res = await request(probeWith({ INTERNAL_KEY_POS: current })).get("/whoami").set("x-internal-key", current);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ caller: "pos" });
    });

    it("accepts the _NEXT key alone", async () => {
      const res = await request(probeWith({ INTERNAL_KEY_POS_NEXT: next })).get("/whoami").set("x-internal-key", next);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ caller: "pos" });
    });

    it("accepts either key when both are set", async () => {
      const probe = probeWith({ INTERNAL_KEY_POS: current, INTERNAL_KEY_POS_NEXT: next });
      for (const key of [current, next]) {
        const res = await request(probe).get("/whoami").set("x-internal-key", key);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ caller: "pos" });
      }
    });

    it("ignores a too-short _NEXT key", async () => {
      const keys = internalKeysFromEnv({ INTERNAL_KEY_POS: current, INTERNAL_KEY_POS_NEXT: "short" });
      expect(keys).toHaveLength(1);
      expect(identifyCaller("short", keys)).toBeNull();
      const res = await request(probeWith({ INTERNAL_KEY_POS: current, INTERNAL_KEY_POS_NEXT: "short" }))
        .get("/whoami")
        .set("x-internal-key", "short");
      expect(res.status).toBe(401);
    });

    it("refuses a wrong key, counts it and logs it without the key", async () => {
      const lines: string[] = [];
      const probe = probeWith({ INTERNAL_KEY_POS: current, INTERNAL_KEY_POS_NEXT: next }, lines);
      const before = rejectedInternalKeyCount();
      const wrong = "w".repeat(40);

      const res = await request(probe).get("/whoami").set("x-internal-key", wrong);
      expect(res.status).toBe(401);
      const missing = await request(probe).get("/whoami").unset("x-internal-key");
      expect(missing.status).toBe(401);

      expect(rejectedInternalKeyCount()).toBe(before + 2);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/unknown key from \S+/);
      expect(lines[1]).toMatch(/missing key from \S+/);
      for (const line of lines) {
        expect(line).not.toContain(wrong);
        expect(line).not.toContain(current);
        expect(line).not.toMatch(/[0-9a-f]{64}/);
      }
    });

    it("logs one line per IP and reason per window, still counts every refusal, and cuts long paths", async () => {
      const lines: string[] = [];
      let t = 0;
      const probe = express();
      probe.use(requireInternalKey({ openPaths: [], keys: [], log: (l) => lines.push(l), logWindowMs: 1000, now: () => t }));
      probe.use((err: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
        res.status(err.statusCode ?? 500).end()
      );
      const before = rejectedInternalKeyCount();
      const longPath = `/${"p".repeat(500)}`;

      for (let i = 0; i < 5; i++) {
        expect((await request(probe).get(longPath).unset("x-internal-key")).status).toBe(401);
      }
      expect(rejectedInternalKeyCount()).toBe(before + 5);
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain("p".repeat(101));
      expect(lines[0]).toContain("...");

      // A different reason from the same IP is its own window.
      await request(probe).get("/x").set("x-internal-key", "w".repeat(40));
      expect(lines).toHaveLength(2);

      t = 1000;
      await request(probe).get("/x").unset("x-internal-key");
      expect(lines).toHaveLength(3);
      expect(lines[2]).toMatch(/missing key .*4 similar not logged/);
    });

    it("behind a proxy, a junk or very long X-Forwarded-For is logged as 'invalid ip' and shares one window", async () => {
      const lines: string[] = [];
      const probe = express();
      probe.set("trust proxy", 1);
      probe.use(requireInternalKey({ openPaths: [], keys: [], log: (l) => lines.push(l), logWindowMs: 1000, now: () => 0 }));
      probe.use((err: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
        res.status(err.statusCode ?? 500).end()
      );
      const forged = `not-an-ip ) [internal-key] fake ${"A".repeat(8000)}`;
      for (let i = 0; i < 5; i++) {
        const res = await request(probe).get("/x").unset("x-internal-key").set("x-forwarded-for", `${forged}${i}`);
        expect(res.status).toBe(401);
      }
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("from invalid ip on GET /x");
      expect(lines[0]).not.toContain("fake");
      expect(lines[0].length).toBeLessThan(200);

      // A real address in the header is still logged as that address.
      await request(probe).get("/x").unset("x-internal-key").set("x-forwarded-for", "203.0.113.9");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("from 203.0.113.9 ");
    });

    it("caps lines across all callers per window, still counting every refusal", async () => {
      const lines: string[] = [];
      let t = 0;
      const probe = express();
      probe.set("trust proxy", 1);
      probe.use(
        requireInternalKey({ openPaths: [], keys: [], log: (l) => lines.push(l), logWindowMs: 1000, now: () => t, maxLinesPerWindow: 3 })
      );
      probe.use((err: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
        res.status(err.statusCode ?? 500).end()
      );
      const before = rejectedInternalKeyCount();
      for (let i = 1; i <= 10; i++) {
        await request(probe).get("/x").unset("x-internal-key").set("x-forwarded-for", `198.51.100.${i}`);
      }
      expect(rejectedInternalKeyCount()).toBe(before + 10);
      expect(lines).toHaveLength(3);

      t = 1000;
      await request(probe).get("/x").unset("x-internal-key").set("x-forwarded-for", "198.51.100.200");
      expect(lines).toHaveLength(4);
      expect(lines[3]).toMatch(/7 from other callers not logged/);
    });
  });
});
