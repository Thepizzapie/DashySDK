/**
 * Integration tests for reportMiddleware (src/server/middleware.ts)
 *
 * Uses supertest + a lightweight express app so we exercise the full
 * middleware stack without mocking req/res internals.
 */

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Dashboard } from "../../src/types.js";
import { reportMiddleware } from "../../src/server/middleware.js";
import { MemoryDashboardStore } from "../../src/publish/index.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  const now = new Date();
  return {
    id: "dash_test0000000001",
    title: "Test Dashboard",
    prompt: "Show me test data",
    mode: "charts",
    html_content: "<html><body><h1>Test</h1></body></html>",
    is_public: false,
    live_enabled: false,
    refresh_interval: 300,
    source_bindings: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildApp(store: MemoryDashboardStore, auth?: (req: express.Request) => boolean | Promise<boolean>) {
  const app = express();
  app.use("/dashboards", reportMiddleware({ store, auth }));
  return app;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("reportMiddleware", () => {
  let store: MemoryDashboardStore;

  beforeEach(() => {
    store = new MemoryDashboardStore();
  });

  it("lists dashboards — GET / with 2 dashboards returns JSON array of 2", async () => {
    await store.save(makeDashboard({ id: "dash_aaa0000000001", title: "Alpha" }));
    await store.save(makeDashboard({ id: "dash_bbb0000000002", title: "Beta" }));

    const app = buildApp(store);
    const res = await request(app).get("/dashboards");

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/json/);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    const ids = res.body.map((d: { id: string }) => d.id);
    expect(ids).toContain("dash_aaa0000000001");
    expect(ids).toContain("dash_bbb0000000002");
  });

  it("returns 404 for missing dashboard — GET /nonexistent-id returns 404", async () => {
    const app = buildApp(store);
    const res = await request(app).get("/dashboards/nonexistent-id");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Dashboard not found" });
  });

  it("serves dashboard HTML — GET /:id returns html_content as text/html", async () => {
    const html = "<html><body><h1>My Dashboard</h1></body></html>";
    await store.save(makeDashboard({ id: "dash_html000000001", html_content: html }));

    const app = buildApp(store);
    const res = await request(app).get("/dashboards/dash_html000000001");

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toBe(html);
  });

  it("auth hook blocks unauthorized — auth: () => false returns 401", async () => {
    await store.save(makeDashboard({ id: "dash_blocked00001" }));

    const app = buildApp(store, () => false);

    // list route
    const listRes = await request(app).get("/dashboards");
    expect(listRes.status).toBe(401);
    expect(listRes.body).toMatchObject({ error: "Unauthorized" });

    // individual route
    const getRes = await request(app).get("/dashboards/dash_blocked00001");
    expect(getRes.status).toBe(401);
  });

  it("auth hook allows authorized — auth: () => true serves content normally", async () => {
    await store.save(makeDashboard({ id: "dash_allowed00001", title: "Allowed" }));

    const app = buildApp(store, () => true);

    const res = await request(app).get("/dashboards");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("dash_allowed00001");
  });

  it("auth hook is async — async auth returning Promise<true> works", async () => {
    await store.save(makeDashboard({ id: "dash_async000001", title: "Async Auth" }));

    const app = buildApp(store, async () => Promise.resolve(true));

    const res = await request(app).get("/dashboards/dash_async000001");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
  });
});

// ── Rate limiting tests ───────────────────────────────────────────────────────

describe("rate limiting", () => {
  it("allows requests under the limit", async () => {
    const store = new MemoryDashboardStore();
    const app = express();
    app.use("/d", reportMiddleware({
      store,
      rateLimit: { windowMs: 60_000, maxRequests: 3 },
    }));

    // 3 requests should all be allowed
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get("/d/");
      expect(res.status).not.toBe(429);
    }
  });

  it("returns 429 when limit exceeded", async () => {
    const store = new MemoryDashboardStore();
    const app = express();
    app.use("/d", reportMiddleware({
      store,
      rateLimit: { windowMs: 60_000, maxRequests: 2 },
    }));

    await request(app).get("/d/");
    await request(app).get("/d/");
    const res = await request(app).get("/d/");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Too many requests");
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("includes X-RateLimit headers", async () => {
    const store = new MemoryDashboardStore();
    const app = express();
    app.use("/d", reportMiddleware({
      store,
      rateLimit: { windowMs: 60_000, maxRequests: 10 },
    }));

    // First request creates the entry; second request triggers header injection
    await request(app).get("/d/");
    const res = await request(app).get("/d/");
    expect(res.headers["x-ratelimit-limit"]).toBe("10");
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("health endpoint bypasses rate limit", async () => {
    const store = new MemoryDashboardStore();
    const app = express();
    app.use("/d", reportMiddleware({
      store,
      rateLimit: { windowMs: 60_000, maxRequests: 1 },
    }));

    // exhaust limit
    await request(app).get("/d/");
    await request(app).get("/d/");

    // health should still work
    const res = await request(app).get("/d/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

// ── Health endpoint tests ─────────────────────────────────────────────────────

describe("health endpoint", () => {
  it("returns status ok with version and uptime", async () => {
    const store = new MemoryDashboardStore();
    const app = express();
    app.use("/api", reportMiddleware({ store }));

    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBeDefined();
    expect(typeof res.body.uptimeMs).toBe("number");
  });

  it("health endpoint skips auth", async () => {
    const store = new MemoryDashboardStore();
    const app = express();
    app.use("/api", reportMiddleware({
      store,
      auth: () => false, // rejects everything
    }));

    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200); // health bypasses auth
  });
});

// ── ETag caching tests ────────────────────────────────────────────────────────

describe("ETag caching", () => {
  it("returns ETag header on dashboard HTML", async () => {
    const store = new MemoryDashboardStore();
    const dashboard = makeDashboard();
    await store.save(dashboard);

    const app = express();
    app.use("/d", reportMiddleware({ store }));

    const res = await request(app).get(`/d/${dashboard.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBeDefined();
  });

  it("returns 304 on matching If-None-Match", async () => {
    const store = new MemoryDashboardStore();
    const dashboard = makeDashboard();
    await store.save(dashboard);

    const app = express();
    app.use("/d", reportMiddleware({ store }));

    const first = await request(app).get(`/d/${dashboard.id}`);
    const etag = first.headers["etag"];

    const second = await request(app)
      .get(`/d/${dashboard.id}`)
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
  });
});
