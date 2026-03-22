// ── Core data types ────────────────────────────────────────────────────────────

export type ScalarType = "string" | "number" | "boolean" | "date" | "datetime" | "json" | "unknown";

export interface Column {
  name: string;
  label: string;
  type: ScalarType;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: { entity: string; column: string };
  description?: string;
  /** inferred from data: high-cardinality string = dimension, numeric = metric candidate */
  role?: "dimension" | "metric" | "identifier" | "timestamp";
}

export interface Entity {
  name: string;
  label: string;
  /** SQL table/view name or GQL type name */
  sourceName: string;
  columns: Column[];
  rowCount?: number;
  /** first N rows for Claude context */
  sample?: Row[];
  description?: string;
}

export interface Relationship {
  from: { entity: string; column: string };
  to: { entity: string; column: string };
  type: "one-to-one" | "one-to-many" | "many-to-many";
  label?: string;
}

export interface Metric {
  name: string;
  label: string;
  /** SQL expression, e.g. "SUM(revenue)" */
  expression: string;
  entity: string;
  aggregation: "sum" | "avg" | "count" | "min" | "max" | "custom";
  format?: "currency" | "percent" | "number" | "duration";
}

export interface SemanticModel {
  entities: Entity[];
  relationships: Relationship[];
  /** Auto-inferred or user-defined metrics */
  metrics: Metric[];
  /** Source system metadata */
  source: { type: string; name?: string };
}

export type Row = Record<string, unknown>;

// ── Connector types ────────────────────────────────────────────────────────────

export interface PostgresSourceConfig {
  type: "postgres";
  connectionString: string;
  /** Tables/views to include (default: all public) */
  include?: string[];
  /** Tables/views to exclude */
  exclude?: string[];
  /** Max rows to sample per table (default: 5) */
  sampleSize?: number;
}

export interface GraphQLSourceConfig {
  type: "graphql";
  endpoint: string;
  headers?: Record<string, string>;
  /** GQL types to include (default: all query root fields) */
  include?: string[];
  /** Extra queries to run for sample data: { TypeName: "query { items { ... } }" } */
  sampleQueries?: Record<string, string>;
}

export interface RestSourceConfig {
  type: "rest";
  /** OpenAPI/Swagger spec URL or path */
  schemaUrl: string;
  /** Base URL for actual requests */
  baseUrl: string;
  headers?: Record<string, string>;
  /** Which endpoints to treat as entity collections */
  endpoints?: string[];
}

export interface InlineSourceConfig {
  type: "inline";
  /** Pre-built semantic model — skip introspection */
  model: SemanticModel;
}

export type DataSourceConfig =
  | PostgresSourceConfig
  | GraphQLSourceConfig
  | RestSourceConfig
  | InlineSourceConfig;

// ── Dashboard types ─────────────────────────────────────────────────────────────

export type DashboardMode = "html" | "mui" | "charts" | "infographic" | "diagram";

export interface ReportOptions {
  prompt: string;
  mode?: DashboardMode;
  /** Pre-fetched data to include (augments schema-derived data) */
  data?: Record<string, Row[]>;
  /** Specific entities to focus on (default: let Claude decide) */
  entities?: string[];
  /** Max rows to send to the AI per entity (default: 200). Keep small — this goes in the prompt. */
  dataLimit?: number;
  /**
   * Max rows to hydrate into the final HTML per entity (default: 5000).
   * After generation the SDK re-queries the same source at full scale and
   * replaces the AI's sample arrays with real data before returning.
   * Set to 0 to disable hydration.
   */
  hydrateLimit?: number;
}

export interface Dashboard {
  id: string;                        // "dash_" + random chars
  title: string;
  description?: string;
  mode: DashboardMode;
  prompt: string;
  html_content: string;              // the generated HTML (was `html`)
  generation_meta?: Record<string, unknown>;
  is_public: boolean;
  public_slug?: string;
  live_enabled: boolean;
  refresh_interval: number;          // seconds, default 300
  source_bindings: string[];         // data source IDs
  created_at: Date;
  updated_at: Date;
}

export interface DashboardStore {
  save(dashboard: Dashboard): Promise<void>;
  get(id: string): Promise<Dashboard | null>;
  list(): Promise<Dashboard[]>;
  delete(id: string): Promise<void>;
}

/** @deprecated Use DashboardStore instead */
export type ReportStore = DashboardStore;

// ── SDK config ─────────────────────────────────────────────────────────────────

export type LLMProvider = "anthropic" | "openai";

export interface SDKConfig {
  /** LLM provider (default: "anthropic") */
  provider?: LLMProvider;
  /** Anthropic API key — required when provider is "anthropic" */
  anthropicKey?: string;
  /** OpenAI API key — required when provider is "openai" */
  openaiKey?: string;
  /**
   * Model override.
   * Anthropic default: "claude-haiku-4-5-20251001"
   * OpenAI default: "gpt-4.5-nano"
   */
  model?: string;
  /** Optional store for saving generated dashboards */
  store?: DashboardStore;
}

// ── Connector interface ────────────────────────────────────────────────────────

export interface Connector {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  introspect(): Promise<SemanticModel>;
  /** Run an arbitrary query and return rows */
  query(q: string, params?: unknown[]): Promise<Row[]>;
}
