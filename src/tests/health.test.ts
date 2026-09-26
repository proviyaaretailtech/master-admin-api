import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../index";

describe("Backend API & Security Integration Tests", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
  });

  describe("Base & Health Check Endpoints", () => {
    it("should return root API information", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("message");
      expect(res.body.message).toContain("Proviyaa Master Backend API");
      expect(res.body).toHaveProperty("healthCheck");
    });

    it("should return 200 OK on health check endpoint", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status", "healthy");
      expect(res.body).toHaveProperty("uptime");
      expect(res.body).toHaveProperty("timestamp");
    });

    it("should return 404 for nonexistent routes", async () => {
      const res = await request(app).get("/api/unknown-endpoint-xyz");
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("message", "Route not found");
    });
  });

  describe("Security Headers & Restrictions", () => {
    it("should include security headers from Helmet", async () => {
      const res = await request(app).get("/api/health");
      // Helmet nosniff header
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      // Helmet frameguard header
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    });

    it("should reject payloads exceeding body limit", async () => {
      // Create a payload larger than 1MB
      const largeData = "x".repeat(1.5 * 1024 * 1024);
      const res = await request(app)
        .post("/api/organizations")
        .set("Content-Type", "application/json")
        .send({ data: largeData });

      // Should be rejected by body-parser with 413 Payload Too Large
      expect(res.status).toBe(413);
    });
  });
});
