import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Dashboard, DashboardStore } from "../types.js";

export interface ReportMiddlewareOptions {
  store: DashboardStore;
  /** Path prefix (default: "/dashboards") */
  path?: string;
}

/**
 * Express middleware that serves saved dashboards.
 *
 * Mount it at your dashboards path:
 *   app.use("/dashboards", reportMiddleware({ store }))
 *
 * Routes served:
 *   GET /dashboards/:id        — serve dashboard HTML
 *   GET /dashboards/:id/meta   — return dashboard metadata as JSON
 *   GET /dashboards            — list all dashboards (JSON)
 */
export function reportMiddleware(opts: ReportMiddlewareOptions): RequestHandler {
  const { store } = opts;

  return async (req: Request, res: Response, next: NextFunction) => {
    const url = req.path;

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

    // Serve HTML
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "ALLOWALL"); // embeddable
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
