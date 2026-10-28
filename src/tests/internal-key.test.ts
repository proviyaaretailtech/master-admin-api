import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import app from "../index";
import { TEST_INTERNAL_KEYS } from "./helpers/internal-keys";
import { identifyCaller, internalKeysFromEnv } from "../config/internal-keys.config";
import { requireInternalKey } from "../middlewares/internal-key.middleware";

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
});
