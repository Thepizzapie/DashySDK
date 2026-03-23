import { createConnector } from "./connectors/index.js";
import { generateReport, generateReportStream } from "./generate/index.js";
import { MemoryDashboardStore } from "./publish/index.js";
import { redactPiiColumns } from "./connectors/utils.js";
import type {
  SDKConfig,
  LLMProvider,
  DataSourceConfig,
  ReportOptions,
  Dashboard,
  DashboardStore,
  Row,
  SemanticModel,
} from "./types.js";

export type {
  SDKConfig,
  LLMProvider,
  DataSourceConfig,
  ReportOptions,
  Dashboard,
  DashboardStore,
  SemanticModel,
  Row,
};
export type { Column, Entity, Relationship, Metric, DashboardMode, ReportStore } from "./types.js";
export type { Connector } from "./types.js";
export { createConnector } from "./connectors/index.js";
export { MemoryDashboardStore, MemoryReportStore } from "./publish/index.js";
export { reportMiddleware } from "./server/middleware.js";
export { extractSentinelKeys } from "./hydrate.js";
export { prepareDoc } from "./frame/prepareDoc.js";
export { redactPiiColumns } from "./connectors/utils.js";

export interface DeployOptions {
  /** Re-query interval in seconds (default: 300 = 5 min) */
  refreshInterval?: number;
  /** Override which entity names to bind (default: auto-detected from generation) */
  sourceBindings?: string[];
}

// ── Main SDK class ─────────────────────────────────────────────────────────────

export class ReportSDK {
  private store?: DashboardStore;

  constructor(private config: SDKConfig) {
    const provider = config.provider ?? "anthropic";
    if (provider === "anthropic" && !config.anthropicKey) {
      throw new Error("anthropicKey is required when provider is \"anthropic\"");
    }
    if (provider === "openai" && !config.openaiKey) {
      throw new Error("openaiKey is required when provider is \"openai\"");
    }
    if (config.store) {
      this.store = config.store;
    }
  }

  /**
   * Introspect a data source and return its semantic model.
   * Use this to preview the schema before generating dashboards.
   */
  async introspect(source: DataSourceConfig): Promise<SemanticModel> {
    const connector = createConnector(source);
    await connector.connect();
    try {
      return await connector.introspect();
    } finally {
      await connector.disconnect();
    }
  }

  /**
   * Generate a dashboard from a data source.
   *
   * @example
   * const dashboard = await sdk.generate(
   *   { type: "postgres", connectionString: process.env.DATABASE_URL },
   *   { prompt: "Monthly revenue by product category", mode: "charts" }
   * );
   */
  async generate(
    source: DataSourceConfig,
    options: ReportOptions
  ): Promise<Dashboard> {
    const connector = createConnector(source);
    await connector.connect();
    try {
      const model = await connector.introspect();
      const queryData = await this.fetchQueryData(connector, model, options);
      return await generateReport(model, options, this.config, queryData);
    } finally {
      await connector.disconnect();
    }
  }

  /**
   * Generate from a pre-built semantic model (no DB connection needed).
   */
  async generateFromModel(
    model: SemanticModel,
    options: ReportOptions,
    queryData: Record<string, Row[]> = {}
  ): Promise<Dashboard> {
    return generateReport(model, options, this.config, queryData);
  }

  /**
   * Stream dashboard generation deltas (for real-time preview).
   */
  stream(
    source: DataSourceConfig,
    options: ReportOptions
  ): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; dashboard: Dashboard }> {
    return this._streamFromSource(source, options);
  }

  private async *_streamFromSource(
    source: DataSourceConfig,
    options: ReportOptions
  ): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; dashboard: Dashboard }> {
    const connector = createConnector(source);
    await connector.connect();
    try {
      const model = await connector.introspect();
      const queryData = await this.fetchQueryData(connector, model, options);
      for await (const chunk of generateReportStream(model, options, this.config, queryData)) {
        yield chunk;
      }
    } finally {
      await connector.disconnect();
    }
  }

  /**
   * Save a dashboard to the configured store, returning the saved dashboard.
   */
  async publish(dashboard: Dashboard): Promise<Dashboard> {
    if (!this.store) throw new Error("SDK not configured with a store — pass store: new MemoryDashboardStore() to createSDK()");
    await this.store.save(dashboard);
    return dashboard;
  }

  /**
   * Enable live data for a dashboard and save it to the configured store.
   * Sets live_enabled=true, applies the refresh interval, and optionally
   * overrides which entity names are bound to live data.
   */
  async deploy(dashboard: Dashboard, options: DeployOptions = {}): Promise<Dashboard> {
    if (!this.store) throw new Error("SDK not configured with a store");

    dashboard.live_enabled = true;
    dashboard.refresh_interval = options.refreshInterval ?? 300;

    if (options.sourceBindings) {
      dashboard.source_bindings = options.sourceBindings;
    }

    dashboard.updated_at = new Date();
    await this.store.save(dashboard);
    return dashboard;
  }

  /**
   * List all saved dashboards.
   */
  async list(): Promise<Dashboard[]> {
    if (!this.store) throw new Error("SDK not configured with a store");
    return this.store.list();
  }

  /**
   * Fetch pre-query data for entities targeted in options.entities.
   * Falls back to data in options.data if provided.
   */
  private async fetchQueryData(
    connector: { query(q: string, params?: unknown[]): Promise<Row[]> },
    model: SemanticModel,
    options: ReportOptions
  ): Promise<Record<string, Row[]>> {
    const result: Record<string, Row[]> = { ...(options.data ?? {}) };

    const limit = options.dataLimit ?? 200;
    const targets = options.entities ?? model.entities.map(e => e.name);

    await Promise.all(
      targets.map(async entityName => {
        if (result[entityName]) return; // already provided
        const entity = model.entities.find(e => e.name === entityName);
        if (!entity) return;

        try {
          const sourceType = model.source.type;
          if (sourceType === "postgres") {
            if (entity.sourceName.includes('"') || entity.sourceName.includes(';')) {
              throw new Error(`Unsafe entity sourceName: ${entity.sourceName}`);
            }
            const rows = await connector.query(
              `SELECT * FROM "${entity.sourceName}" LIMIT $1`,
              [limit]
            );
            result[entityName] = redactPiiColumns(rows);
          } else if (sourceType === "graphql") {
            const scalarCols = entity.columns
              .filter(c => !c.isForeignKey)
              .map(c => c.name)
              .join(" ");
            if (scalarCols) {
              if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entity.sourceName)) {
                throw new Error(`Unsafe entity sourceName for GraphQL: ${entity.sourceName}`);
              }
              const rows = await connector.query(
                `{ ${entity.sourceName}(first: ${limit}) { ${scalarCols} } }`
              );
              result[entityName] = redactPiiColumns(rows);
            }
          }
        } catch (_) {
          // Non-fatal: dashboard will use schema context + sample rows
        }
      })
    );

    return result;
  }
}

/**
 * Convenience factory — create and return an SDK instance.
 */
export function createSDK(config: SDKConfig): ReportSDK {
  return new ReportSDK(config);
}
