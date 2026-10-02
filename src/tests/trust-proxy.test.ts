/**
 * MA-5: behind a reverse proxy (Vercel) the app must use the client IP the proxy reports. With
 * TRUST_PROXY=1 each client gets its own rate-limit bucket, so one noisy client cannot lock every admin out.
 * Without it, a spoofed X-Forwarded-For header must NOT let a client choose its own bucket.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

async function loadApp(trustProxy: string): Promise<Express> {
  vi.resetModules();
  process.env.TRUST_PROXY = trustProxy;
  return (await import("../index")).default as Express;
}

describe("MA-5 trust proxy and the rate limiter", () => {
  afterAll(() => {
    delete process.env.TRUST_PROXY;
  });

  it("with TRUST_PROXY=1 every forwarded client has its own login budget", async () => {
    const app = await loadApp("1");
    expect(app.get("trust proxy")).toBe(1);

    let last = 0;
    for (let i = 0; i < 20 && last !== 429; i++) {
      last = (await request(app).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.10").send({ email: "a@test.local", password: "x" })).status;
    }
    expect(last).toBe(429); // the noisy client is limited...

    const other = await request(app).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.99").send({ email: "b@test.local", password: "x" });
    expect(other.status).toBe(401); // ...a different client is not locked out with it
  });

  it("with TRUST_PROXY=0 (default) a spoofed X-Forwarded-For cannot buy a fresh login budget", async () => {
    const app = await loadApp("0");
    expect(app.get("trust proxy")).toBe(0);

    let last = 0;
    for (let i = 0; i < 20 && last !== 429; i++) {
      last = (await request(app).post("/api/auth/login").send({ email: "a@test.local", password: "x" })).status;
    }
    expect(last).toBe(429);
    const spoofed = await request(app).post("/api/auth/login").set("X-Forwarded-For", "198.51.100.77").send({ email: "a@test.local", password: "x" });
    expect(spoofed.status).toBe(429);
  });

  it("refuses to boot with TRUST_PROXY=true (it would let clients pick their own IP)", async () => {
    await expect(loadApp("true")).rejects.toThrow(/TRUST_PROXY/);
  });
});
