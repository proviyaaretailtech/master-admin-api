/**
 * Master Admin P3 hardening findings: CORS, error leakage, production-by-default environment, database TLS
 * verification, logout, the login rate-limit scope, and input validation on locations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, createOrg, cleanup } from "./helpers/testkit";
import {
  buildAllowedCorsOrigins,
  isCorsOriginAllowed,
  parseTrustProxy,
} from "../config/security.config";
import { isLocalDatabaseUrl, sslSettingFromEnv, sslForDatabaseUrl, stripSslParams } from "../config/ssl.config";
import { buildPoolConfig } from "../config/database.config";
import { resolveNodeEnv, missingProductionSettings } from "../config/boot-guard";

describe("CORS", () => {
  it("allows no-Origin callers and the configured origins; refuses everything else with 403", async () => {
    const noOrigin = await request(app).get("/api/health");
    expect(noOrigin.status).toBe(200);

    const allowed = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const evil = await request(app).get("/api/health").set("Origin", "https://evil.example.com");
    expect(evil.status).toBe(403);
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("no longer trusts every *.vercel.app origin (any site hosted there could otherwise call the API with credentials)", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://attacker-app.vercel.app");
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("refuses a disallowed origin's preflight (no CORS headers are granted)", async () => {
    const res = await request(app)
      .options("/api/users")
      .set("Origin", "https://attacker-app.vercel.app")
      .set("Access-Control-Request-Method", "DELETE");
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows same-origin browser requests (Origin host equals the Host the API is served on)", async () => {
    const res = await request(app).get("/api/health").set("Host", "admin.example.com").set("Origin", "https://admin.example.com");
    expect(res.status).toBe(200);
  });

  it("unit: origin list is exact-match, comma separated, and drops local dev origins in production", () => {
    const prod = buildAllowedCorsOrigins("https://a.example.com/, https://b.example.com", "production");
    expect(prod).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(isCorsOriginAllowed("https://a.example.com", "api.example.com", prod)).toBe(true);
    expect(isCorsOriginAllowed("https://a.example.com.evil.com", "api.example.com", prod)).toBe(false);
    expect(isCorsOriginAllowed("http://localhost:5173", "api.example.com", prod)).toBe(false);
    expect(isCorsOriginAllowed("https://x.vercel.app", "api.example.com", prod)).toBe(false);
    expect(isCorsOriginAllowed(undefined, undefined, prod)).toBe(true);
    expect(buildAllowedCorsOrigins("https://a.example.com", "development")).toContain("http://localhost:5173");
  });
});

describe("trust proxy configuration (MA-5)", () => {
  it("accepts a hop count, treats false/empty as none, and refuses 'true' (which would let clients choose their IP)", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("0")).toBe(0);
    expect(parseTrustProxy("false")).toBe(0);
    expect(parseTrustProxy(undefined)).toBe(0);
    expect(() => parseTrustProxy("true")).toThrow();
    expect(() => parseTrustProxy("-1")).toThrow();
    expect(() => parseTrustProxy("99")).toThrow();
  });
});

describe("error responses", () => {
  it("never leaks internals on a 500: no message, stack or SQL, even in development-like leak paths", async () => {
    const { errorHandler } = await import("../middlewares/errorHandler.middleware");
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(b: unknown) {
        this.body = b;
        return this;
      },
    };
    const err = Object.assign(new Error('relation "secret_table" does not exist at SELECT * FROM secret_table'), { code: "42P01" });
    errorHandler(err, {} as never, res as never, (() => undefined) as never);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/secret_table|42P01|stack|SELECT/);
    expect(res.body).toMatchObject({ message: "Internal Server Error" });
  });

  it("answers a malformed JSON body with 400, not a 500", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Malformed JSON/);
  });

  it("the health endpoint reveals liveness only (no environment, uptime or service banner)", async () => {
    const res = await request(app).get("/api/health");
    expect(Object.keys(res.body).sort()).toEqual(["status", "timestamp"]);
  });

  it("an UNSET or blank NODE_ENV is treated as production (no stack traces, production boot guard applies)", () => {
    expect(resolveNodeEnv(undefined)).toBe("production");
    expect(resolveNodeEnv("")).toBe("production");
    expect(resolveNodeEnv("  ")).toBe("production");
    expect(resolveNodeEnv("Production")).toBe("production");
    expect(resolveNodeEnv("development")).toBe("development");
    expect(resolveNodeEnv("test")).toBe("test");
  });

  it("production refuses to start without real settings, and with a remote database but no CA to verify it", () => {
    const real = {
      SUPABASE_URL: "https://real.example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      DATABASE_URL: "postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
    };
    expect(missingProductionSettings({ ...real, SUPABASE_SERVICE_ROLE_KEY: "" }, { DATABASE_SSL_CA: "pem" })).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
    expect(missingProductionSettings({ ...real, SUPABASE_URL: "https://placeholder.supabase.co" }, { DATABASE_SSL_CA: "pem" })).toEqual(["SUPABASE_URL"]);
    // remote DB, no CA, no explicit opt-out -> refuse
    expect(missingProductionSettings(real, {})[0]).toMatch(/DATABASE_SSL_CA/);
    // CA supplied, or a deliberate opt-out -> ok
    expect(missingProductionSettings(real, { DATABASE_SSL_CA: "pem" })).toEqual([]);
    expect(missingProductionSettings(real, { DATABASE_SSL_REJECT_UNAUTHORIZED: "false" })).toEqual([]);
    // local database needs no CA
    expect(missingProductionSettings({ ...real, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x" }, {})).toEqual([]);
  });
});

describe("database TLS verification", () => {
  it("verifies the certificate by default for a remote database and never for a local one", () => {
    expect(sslForDatabaseUrl("postgresql://u:p@db.example.com:5432/x", {})).toEqual({ rejectUnauthorized: true });
    expect(sslForDatabaseUrl("postgresql://u:p@127.0.0.1:54322/ma_test", {})).toBe(false);
    expect(isLocalDatabaseUrl("postgresql://u:p@localhost:5432/x")).toBe(true);
    // a hostile URL that merely mentions localhost must not be treated as local
    expect(isLocalDatabaseUrl("postgresql://u:p@evil.example.com:5432/x?host=localhost")).toBe(false);
  });

  it("pins a supplied CA (PEM with literal \\n accepted) and only skips verification on an explicit opt-out", () => {
    const pinned = sslSettingFromEnv({ DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----" });
    expect(pinned.mode).toBe("pinned");
    expect(pinned.ssl).toMatchObject({ rejectUnauthorized: true });
    expect((pinned.ssl as { ca: string }).ca).toContain("\nabc\n");

    expect(sslSettingFromEnv({}).mode).toBe("unconfigured");
    expect(sslSettingFromEnv({ DATABASE_SSL_REJECT_UNAUTHORIZED: "false" })).toMatchObject({ mode: "insecure", ssl: { rejectUnauthorized: false } });
    expect(sslSettingFromEnv({ DATABASE_SSL_REJECT_UNAUTHORIZED: "true" }).mode).toBe("unconfigured");
  });

  it("builds a pool config that verifies the certificate and drops sslmode from the URL so the pinned CA is not overridden", () => {
    const cfg = buildPoolConfig("postgresql://u:p@pooler.example.com:6543/postgres?sslmode=require&application_name=ma", {
      DATABASE_SSL_CA: "PEMTEXT",
    });
    expect(cfg.ssl).toMatchObject({ rejectUnauthorized: true, ca: "PEMTEXT" });
    expect(cfg.connectionString).toBe("postgresql://u:p@pooler.example.com:6543/postgres?application_name=ma");

    const direct = buildPoolConfig("postgresql://postgres:secret@db.abcdefghij.supabase.co:5432/postgres", {});
    expect(direct.ssl).toMatchObject({ rejectUnauthorized: true });

    expect(stripSslParams("postgresql://u:p@h/db?sslmode=require")).toBe("postgresql://u:p@h/db");
    expect(buildPoolConfig("postgresql://postgres:postgres@127.0.0.1:54322/ma_test", {}).ssl).toBe(false);
  });
});

describe("auth endpoints", () => {
  const staffIds: string[] = [];
  const orgIds: string[] = [];
  let staff: Awaited<ReturnType<typeof createStaff>>;
  const calls = () => (globalThis as unknown as { __signOutCalls?: Array<{ jwt: string; scope?: string }> }).__signOutCalls ?? [];

  beforeAll(async () => {
    staff = await createStaff({ roleKey: "super_admin" });
    staffIds.push(staff.id);
  });
  afterAll(async () => {
    await cleanup({ staffIds, orgIds });
  });

  it("POST /auth/logout revokes the caller's session (it used to be a no-op) and answers the same without a token", async () => {
    const before = calls().length;
    const res = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(calls().length).toBe(before + 1);
    expect(calls()[calls().length - 1]).toEqual({ jwt: staff.token, scope: "local" });

    const anonymous = await request(app).post("/api/auth/logout");
    expect(anonymous.status).toBe(200);
    expect(calls().length).toBe(before + 1);
  });

  it("reading the profile (/auth/me) does not consume the login rate-limit budget", async () => {
    // The login limiter allows 15 attempts per window. 20 profile reads must not exhaust it.
    for (let i = 0; i < 20; i++) {
      const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${staff.token}`);
      expect(me.status).toBe(200);
    }
    const login = await request(app).post("/api/auth/login").send({ email: staff.email, password: "test-password-123" });
    expect(login.status).toBe(200);
  });

  it("an inactive account cannot log in even with the right password, and is refused at /auth/me (403)", async () => {
    const inactive = await createStaff({ roleKey: "super_admin", status: "Inactive" });
    staffIds.push(inactive.id);
    const login = await request(app).post("/api/auth/login").send({ email: inactive.email, password: "test-password-123" });
    expect(login.status).toBe(401);
    expect(login.body.message).toMatch(/deactivated|suspended/);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${inactive.token}`);
    expect(me.status).toBe(403);
  });

  it("login attempts ARE rate limited (429 after the allowed number)", async () => {
    let last = 0;
    for (let i = 0; i < 20; i++) {
      const r = await request(app).post("/api/auth/login").send({ email: "nobody@test.local", password: "x" });
      last = r.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  describe("location input validation", () => {
    it("rejects an invalid time zone or currency with 400 and accepts valid ones", async () => {
      const orgId = await createOrg();
      orgIds.push(orgId);
      const post = (body: Record<string, unknown>) =>
        request(app).post(`/api/organizations/${orgId}/locations`).set("Authorization", `Bearer ${staff.token}`).send(body);

      expect((await post({ name: "Bad Tz", time_zone: "Mars/Olympus" })).status).toBe(400);
      expect((await post({ name: "Bad Cur", currency: "12$" })).status).toBe(400);
      const ok = await post({ name: "Good Loc", time_zone: "Asia/Kolkata", currency: "INR (₹)" });
      expect(ok.status).toBe(201);
      const tz = await query<{ timezone: string }>("SELECT timezone FROM locations WHERE id = $1;", [ok.body.location.id]);
      expect(tz.rows[0].timezone).toBe("Asia/Kolkata");
    });
  });
});
