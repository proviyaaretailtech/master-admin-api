/**
 * Session refresh (httpOnly refresh cookie), sign out everywhere, and password reset.
 * The Supabase auth client is the fake from setup.ts: refresh tokens look like "rt:<auth user id>:<n>".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../index";
import { query } from "../config/database.config";
import { createStaff, cleanup, TestStaff } from "./helpers/testkit";
import { FORGOT_PASSWORD_RESPONSE } from "../controllers/auth.controller";
import { REFRESH_COOKIE } from "../utils/refresh-cookie";
import { resolveFrontendOrigin } from "../config/security.config";

type G = {
  __signOutCalls?: Array<{ jwt: string; scope?: string }>;
  __recoverCalls?: Array<{ email: string; redirectTo?: string }>;
};
const g = globalThis as unknown as G;

const cookieOf = (res: request.Response): string | undefined =>
  ([] as string[])
    .concat(res.headers["set-cookie"] ?? [])
    .find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
const cookieValue = (setCookie: string | undefined) =>
  setCookie?.split(";")[0].slice(REFRESH_COOKIE.length + 1);
const asCookie = (rt: string) => `${REFRESH_COOKIE}=${encodeURIComponent(rt)}`;

describe("Session refresh, sign out everywhere, password reset", () => {
  const staffIds: string[] = [];
  let admin: TestStaff;
  let inactive: TestStaff;
  let outsiderId: string;
  let outsiderEmail: string;

  beforeAll(async () => {
    admin = await createStaff({ roleKey: "super_admin" });
    inactive = await createStaff({ roleKey: "super_admin", status: "Inactive" });
    outsiderEmail = `outsider-${Date.now()}@test.local`;
    const u = await query<{ id: string }>(
      `INSERT INTO auth.users (id, instance_id, aud, role, email)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1) RETURNING id;`,
      [outsiderEmail]
    );
    outsiderId = u.rows[0].id;
    staffIds.push(admin.id, inactive.id, outsiderId);
  });
  afterAll(async () => {
    await cleanup({ staffIds });
  });
  afterEach(() => {
    g.__signOutCalls = [];
    g.__recoverCalls = [];
    vi.unstubAllGlobals();
  });

  describe("login and refresh", () => {
    it("login puts the refresh token in an httpOnly, SameSite=Strict cookie scoped to /api/auth, never in the body", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: admin.email, password: "test-password-123" });
      expect(res.status).toBe(200);
      expect(res.body.token).toBe(admin.token);
      expect(res.body.expiresAt).toBe(4102444800);
      expect(JSON.stringify(res.body)).not.toContain("rt:");
      const c = cookieOf(res)!;
      expect(c).toBeDefined();
      expect(cookieValue(c)).toBe(encodeURIComponent(`rt:${admin.id}:0`));
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=Strict/i);
      expect(c).toMatch(/Path=\/api\/auth/i);
    });

    it("refresh exchanges the cookie for a new access token and rotates the cookie", async () => {
      const res = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", asCookie(`rt:${admin.id}:0`));
      expect(res.status).toBe(200);
      expect(res.body.token).toBe(admin.token);
      expect(res.body.expiresAt).toBe(4102444800);
      expect(cookieValue(cookieOf(res))).toBe(encodeURIComponent(`rt:${admin.id}:1`));
    });

    it("refresh without a cookie is 401", async () => {
      const res = await request(app).post("/api/auth/refresh");
      expect(res.status).toBe(401);
    });

    it("refresh with a revoked/unknown token is 401 and clears the cookie", async () => {
      const res = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", asCookie("not-a-real-token"));
      expect(res.status).toBe(401);
      expect(cookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it("a deactivated admin cannot keep a session alive: 403, the new session is revoked, the cookie cleared", async () => {
      const res = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", asCookie(`rt:${inactive.id}:3`));
      expect(res.status).toBe(403);
      expect(g.__signOutCalls).toContainEqual({ jwt: inactive.token, scope: "local" });
      expect(cookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it("an auth user who is not a platform admin cannot refresh (403)", async () => {
      const res = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", asCookie(`rt:${outsiderId}:0`));
      expect(res.status).toBe(403);
    });
  });

  describe("logout", () => {
    it("default logout ends this session only and clears the cookie", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(g.__signOutCalls).toEqual([{ jwt: admin.token, scope: "local" }]);
      expect(cookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it("scope global signs out everywhere", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ scope: "global" });
      expect(res.status).toBe(200);
      expect(g.__signOutCalls).toEqual([{ jwt: admin.token, scope: "global" }]);
    });

    it("an unknown scope is refused (400)", async () => {
      const res = await request(app).post("/api/auth/logout").send({ scope: "others" });
      expect(res.status).toBe(400);
    });
  });

  describe("forgot password", () => {
    it("answers identically for an admin, an unknown address, a non-admin and an inactive admin", async () => {
      const bodies: unknown[] = [];
      for (const email of [admin.email, "nobody-here@test.local", outsiderEmail, inactive.email]) {
        const res = await request(app).post("/api/auth/forgot-password").send({ email });
        expect(res.status).toBe(200);
        bodies.push(res.body);
      }
      for (const b of bodies) expect(b).toEqual({ message: FORGOT_PASSWORD_RESPONSE });
      await new Promise((r) => setTimeout(r, 20));
      // ...but only the active administrator gets an email
      expect(g.__recoverCalls?.map((c) => c.email)).toEqual([admin.email]);
    });

    it("the link points at the Master Admin /reset-password page of an allowed origin", async () => {
      await request(app)
        .post("/api/auth/forgot-password")
        .set("Origin", "http://localhost:5173")
        .send({ email: admin.email });
      await new Promise((r) => setTimeout(r, 20));
      expect(g.__recoverCalls?.[0]?.redirectTo).toBe("http://localhost:5173/reset-password");
    });

    it("never takes the redirect origin from an unlisted Origin", () => {
      expect(
        resolveFrontendOrigin("https://evil.example", "https://admin.example.com", [
          "https://admin.example.com",
        ])
      ).toBe("https://admin.example.com");
      expect(
        resolveFrontendOrigin("https://b.example", "https://a.example,https://b.example", [
          "https://a.example",
          "https://b.example",
        ])
      ).toBe("https://b.example");
    });

    it("is rate-limited: the 6th request from one address within 15 minutes is refused (429)", async () => {
      // the two tests above used 5 requests from this address
      const res = await request(app).post("/api/auth/forgot-password").send({ email: admin.email });
      expect(res.status).toBe(429);
    });
  });

  describe("reset password", () => {
    it("enforces the staff password strength rule (400)", async () => {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ accessToken: admin.token, password: "short" });
      expect(res.status).toBe(400);
    });

    it("an invalid recovery token is 401", async () => {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ accessToken: "garbage", password: "a-long-new-password-1" });
      expect(res.status).toBe(401);
    });

    it("a recovery token of a non-admin is refused (401)", async () => {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ accessToken: `test:${outsiderId}`, password: "a-long-new-password-1" });
      expect(res.status).toBe(401);
    });

    it("sets the password with Supabase PUT /auth/v1/user using the recovery token, then signs out everywhere", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ id: admin.id }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ accessToken: admin.token, password: "a-long-new-password-1" });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/\/auth\/v1\/user$/);
      expect(init.method).toBe("PUT");
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${admin.token}`);
      expect(JSON.parse(String(init.body))).toEqual({ password: "a-long-new-password-1" });
      expect(g.__signOutCalls).toContainEqual({ jwt: admin.token, scope: "global" });
    });

    it("reports Supabase's 'same password' refusal as a 400", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response(JSON.stringify({ error_code: "same_password" }), { status: 422 })
        )
      );
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ accessToken: admin.token, password: "a-long-new-password-1" });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("same_password");
    });
  });
});
