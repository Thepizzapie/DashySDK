import type { Dashboard, DashboardStore } from "../types.js";

export interface DashyApiStoreConfig {
  /** Base URL of the dashy instance, e.g. "http://localhost:4200" */
  baseUrl: string;
  /** JWT token from dashy login (Authorization: Bearer) */
  token: string;
  /**
   * Optional mapping of entity names → dashy data source IDs.
   * When provided, deploy() will resolve entity names to source IDs so dashy's
   * live data engine can re-query them on refresh.
   *
   * e.g. { orders: "uuid-of-orders-source", customers: "uuid-of-customers-source" }
   */
  sourceIdMap?: Record<string, string>;
}

// Shape returned by the dashy REST API (dates as strings, source_bindings may be string or array)
interface ApiDashboard {
  id: string;
  title: string;
  description?: string;
  mode: Dashboard["mode"];
  prompt: string;
  html_content: string;
  generation_meta?: Record<string, unknown>;
  is_public: boolean;
  public_slug?: string;
  live_enabled: boolean;
  refresh_interval: number;
  source_bindings: string | string[];
  created_at: string;
  updated_at: string;
}

function parseSourceBindings(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapApiToDashboard(api: ApiDashboard): Dashboard {
  return {
    id: api.id,
    title: api.title,
    description: api.description,
    mode: api.mode,
    prompt: api.prompt,
    html_content: api.html_content,
    generation_meta: api.generation_meta,
    is_public: Boolean(api.is_public),
    public_slug: api.public_slug,
    live_enabled: Boolean(api.live_enabled),
    refresh_interval: api.refresh_interval,
    source_bindings: parseSourceBindings(api.source_bindings),
    created_at: new Date(api.created_at),
    updated_at: new Date(api.updated_at),
  };
}

export class DashyApiStore implements DashboardStore {
  private baseUrl: string;
  private token: string;
  private sourceIdMap: Record<string, string>;
  // Track which ids have been persisted to dashy (so we know POST vs PATCH)
  private persisted = new Set<string>();

  constructor(config: DashyApiStoreConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.sourceIdMap = config.sourceIdMap ?? {};
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  private async assertOk(res: Response, context: string): Promise<void> {
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      throw new Error(
        `DashyApiStore ${context}: HTTP ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`
      );
    }
  }

  /**
   * Resolve entity names in source_bindings to dashy source IDs.
   * Falls through to entity name strings if no mapping is configured.
   */
  private resolveSourceBindings(bindings: string[]): string[] {
    if (Object.keys(this.sourceIdMap).length === 0) return bindings;
    return bindings
      .map(name => this.sourceIdMap[name] ?? null)
      .filter((id): id is string => id !== null);
  }

  async save(dashboard: Dashboard): Promise<void> {
    const resolvedBindings = this.resolveSourceBindings(dashboard.source_bindings);

    if (!this.persisted.has(dashboard.id)) {
      // First save — always POST (dashy creates the record, we keep its server-assigned id)
      const body = {
        title: dashboard.title,
        description: dashboard.description,
        mode: dashboard.mode,
        prompt: dashboard.prompt,
        html_content: dashboard.html_content,
        generation_meta: dashboard.generation_meta,
        live_enabled: dashboard.live_enabled ? 1 : 0,
        refresh_interval: dashboard.refresh_interval,
        source_bindings: resolvedBindings,
      };
      const res = await fetch(`${this.baseUrl}/api/dashboards`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      await this.assertOk(res, "save (POST)");
      const created = await res.json() as ApiDashboard;
      // Update the dashboard id to the server-assigned one
      dashboard.id = created.id;
      this.persisted.add(created.id);
    } else {
      // Subsequent saves — PATCH
      const res = await fetch(
        `${this.baseUrl}/api/dashboards/${encodeURIComponent(dashboard.id)}`,
        {
          method: "PATCH",
          headers: this.headers(),
          body: JSON.stringify({
            title: dashboard.title,
            description: dashboard.description,
            html_content: dashboard.html_content,
          }),
        }
      );
      await this.assertOk(res, `save (PATCH ${dashboard.id})`);
    }
  }

  async get(id: string): Promise<Dashboard | null> {
    const res = await fetch(
      `${this.baseUrl}/api/dashboards/${encodeURIComponent(id)}`,
      { headers: this.headers() }
    );
    if (res.status === 404) return null;
    await this.assertOk(res, `get (${id})`);
    return mapApiToDashboard(await res.json() as ApiDashboard);
  }

  async list(): Promise<Dashboard[]> {
    const res = await fetch(`${this.baseUrl}/api/dashboards?limit=100`, { headers: this.headers() });
    await this.assertOk(res, "list");
    const body = await res.json() as any;
    // API returns { dashboards: [...], total, limit, offset } or plain array
    const rows: ApiDashboard[] = Array.isArray(body) ? body : (body.dashboards ?? []);
    return rows.map(mapApiToDashboard);
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/dashboards/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: this.headers() }
    );
    await this.assertOk(res, `delete (${id})`);
    this.persisted.delete(id);
  }
}
