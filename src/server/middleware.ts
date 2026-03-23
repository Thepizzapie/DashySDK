import { createHash } from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Dashboard, DashboardStore } from "../types.js";

// ── Rate limiter ───────────────────────────────────────────────────────────────

interface RateLimitConfig {
  /** Time window in ms (default: 3_600_000 = 1 hour) */
  windowMs?: number;
  /** Max requests per window (default: 60) */
  maxRequests?: number;
  /** Key function — defaults to IP address */
  keyFn?: (req: Request) => string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createRateLimiter(config: RateLimitConfig = {}) {
  const windowMs = config.windowMs ?? 3_600_000;
  const maxRequests = config.maxRequests ?? 60;
  const keyFn = config.keyFn ?? ((req: Request) =>
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? "unknown"
  );
  const store = new Map<string, RateLimitEntry>();

  // Prune expired entries every windowMs to prevent unbounded growth
  const pruneInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) {
      if (v.resetAt <= now) store.delete(k);
    }
  }, windowMs);
  if (pruneInterval.unref) pruneInterval.unref(); // don't prevent process exit

  return function rateLimitMiddleware(req: Request, res: Response): boolean {
    const key = keyFn(req);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return true; // allowed
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.status(429).json({ error: "Too many requests", retryAfter });
      return false; // blocked
    }

    entry.count++;
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", maxRequests - entry.count);
    return true; // allowed
  };
}

// ── Middleware options ─────────────────────────────────────────────────────────

export interface ReportMiddlewareOptions {
  store: DashboardStore;
  /** Path prefix (default: "/dashboards") */
  path?: string;
  auth?: (req: Request) => boolean | Promise<boolean>;
  /** Optional rate limiting for list/serve routes */
  rateLimit?: RateLimitConfig;
}

// ── Shutdown registry ─────────────────────────────────────────────────────────

const _shutdownCallbacks: Array<() => Promise<void>> = [];

/** Register a cleanup function to be called on shutdown() */
export function onShutdown(fn: () => Promise<void>): void {
  _shutdownCallbacks.push(fn);
}

/** Drain in-flight requests and run all registered cleanup functions. */
export async function shutdown(): Promise<void> {
  await Promise.all(_shutdownCallbacks.map(fn => fn().catch(() => {})));
}

// ── SDK version ───────────────────────────────────────────────────────────────

const SDK_VERSION = "0.1.0"; // keep in sync with package.json
const START_TIME = Date.now();

/**
 * Express middleware that serves saved dashboards.
 *
 * Mount it at your dashboards path:
 *   app.use("/dashboards", reportMiddleware({ store }))
 *
 * Routes served:
 *   GET /health              — liveness probe (no auth required)
 *   GET /dashboards/:id      — serve dashboard HTML
 *   GET /dashboards/:id/meta — return dashboard metadata as JSON
 *   GET /dashboards          — list all dashboards (JSON)
 */
export function reportMiddleware(opts: ReportMiddlewareOptions): RequestHandler {
  const { store } = opts;
  const checkRateLimit = opts.rateLimit ? createRateLimiter(opts.rateLimit) : null;

  return async (req: Request, res: Response, next: NextFunction) => {
    const url = req.path;

    // Health check — no auth, no rate limit
    if (url === "/health") {
      res.json({ status: "ok", version: SDK_VERSION, uptimeMs: Date.now() - START_TIME });
      return;
    }

    // Auth check
    if (opts.auth) {
      const allowed = await opts.auth(req);
      if (!allowed) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    // Rate limiting
    if (checkRateLimit) {
      const allowed = checkRateLimit(req, res);
      if (!allowed) return;
    }

    // List dashboards
    if (url === "/" || url === "") {
      const dashboards = await store.list();
      res.json(
        dashboards.map(d => ({
          id: d.id,
          title: d.title,
          mode: d.mode,
          created_at: d.created_at,
        }))
      );
      return;
    }

    // Match /:id or /:id/meta
    const match = url.match(/^\/([^/]+)(\/meta)?$/);
    if (!match) {
      next();
      return;
    }

    const id = match[1];
    const isMeta = !!match[2];

    const dashboard = await store.get(id);
    if (!dashboard) {
      res.status(404).json({ error: "Dashboard not found" });
      return;
    }

    if (isMeta) {
      res.json(toMeta(dashboard));
      return;
    }

    // ETag caching
    const etag = `"${createHash("md5").update(dashboard.html_content).digest("hex")}"`;
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    // Serve HTML
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data:; frame-ancestors *;");
    res.send(dashboard.html_content);
  };
}

function toMeta(d: Dashboard) {
  return {
    id: d.id,
    title: d.title,
    prompt: d.prompt,
    mode: d.mode,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}
