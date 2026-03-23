# @dashy/sdk

Generate embeddable, live-updating dashboards from any database using AI.

Point the SDK at a Postgres, SQLite, or GraphQL source, describe what you want, and get back a self-contained HTML dashboard. Embed it in an iframe and push live data via postMessage — no page reload required.

---

## Install

```bash
npm install @dashy/sdk
```

Requires Node 18+. Peer deps: `react` + `react-dom` ≥ 18 (only if using the React component).

---

## Quick Start

```ts
import { createSDK } from "@dashy/sdk";

const sdk = createSDK({
  provider: "openai",
  openaiKey: process.env.OPENAI_API_KEY,
});

const dashboard = await sdk.generate(
  { type: "postgres", connectionString: process.env.DATABASE_URL },
  { prompt: "Monthly revenue, order count, and AOV for the past year", mode: "charts" }
);

console.log(dashboard.html_content); // self-contained HTML, ready to serve
```

### Streaming (real-time preview)

```ts
for await (const chunk of sdk.stream(source, options)) {
  if (chunk.type === "delta") process.stdout.write(chunk.text);
  if (chunk.type === "done") console.log("Done:", chunk.dashboard.title);
}
```

---

## Embed in an iframe

```ts
import { prepareDoc } from "@dashy/sdk";

// Wrap the raw HTML for safe iframe rendering
const iframeHtml = prepareDoc(dashboard.html_content);

// Serve iframeHtml at a route, then:
// <iframe src="/dashboard/frame" sandbox="allow-scripts allow-same-origin"></iframe>
```

---

## Live Data Injection

Every generated dashboard embeds a `useDashyData(key, fallback)` hook. Push fresh rows to it from the parent page via postMessage — charts update instantly, no reload.

```ts
// 1. Find which keys the dashboard uses
import { extractSentinelKeys } from "@dashy/sdk";
const keys = extractSentinelKeys(dashboard.html_content);
// e.g. ["orders"]

// 2. Inject fresh rows from the parent page
const iframe = document.getElementById("dashboard-frame") as HTMLIFrameElement;
iframe.contentWindow!.postMessage({
  type: "DASHY_UPDATE",
  data: {
    orders: await db.query("SELECT * FROM orders WHERE created_at > now() - interval '12 months'")
  }
}, "*");
```

> **Always send raw database rows** — the same shape as your source table. The dashboard handles aggregation (monthly rollups, bucketing, etc.) in the browser. Never pre-aggregate before injecting.

---

## Generation Modes

| Mode | Stack | Style | Best for |
|------|-------|-------|----------|
| `charts` | Recharts + MUI | Dark, glassmorphic | Analytics, KPI dashboards |
| `mui` | MUI only | Dark, structured | Data overviews, admin panels |
| `diagram` | D3 + SVG | Academic, white | Methodology flows, statistical figures |

---

## Full API

### `createSDK(config)`

```ts
createSDK({
  provider?: "openai" | "anthropic"; // default: "anthropic"
  openaiKey?: string;
  anthropicKey?: string;
  store?: DashboardStore;            // for publish/deploy
})
```

---

### `sdk.generate(source, options)` → `Promise<Dashboard>`
### `sdk.stream(source, options)` → `AsyncGenerator<delta | done>`

**source**
```ts
{ type: "postgres"; connectionString: string; sampleSize?: number }
{ type: "sqlite";   path: string }
{ type: "graphql";  endpoint: string; headers?: Record<string, string> }
```

**options**
```ts
{
  prompt: string;
  mode?: "charts" | "mui" | "diagram"; // default: "charts"
  entities?: string[];    // tables to include (default: all)
  dataLimit?: number;     // rows per entity sent to the AI (default: 200)
  data?: Record<string, Row[]>; // pre-fetched data (skips auto-query)
}
```

---

### `sdk.introspect(source)` → `Promise<SemanticModel>`

Inspect the schema before generating — useful for previewing columns, row counts, and relationships.

---

### `sdk.deploy(dashboard, options?)` → `Promise<Dashboard>`

Enable live data and save to the configured store.

```ts
await sdk.deploy(dashboard, {
  refreshInterval: 300,       // seconds between re-queries (default: 300)
  sourceBindings?: string[],  // override which entity names are bound
});
```

---

### `prepareDoc(html)` → `string`

Prepares raw generated HTML for iframe embedding. Injects the DASHY bootstrap (postMessage listener + `useDashyData`), strips any duplicate declarations, and removes broken chart children.

---

### `extractSentinelKeys(html)` → `string[]`

Returns the entity key names embedded in a dashboard's sentinel markers. Use these as keys when injecting live data.

---

## Publish to Dashy App

```ts
import { createSDK } from "@dashy/sdk";
import { DashyApiStore } from "@dashy/sdk/publish";

const sdk = createSDK({
  provider: "openai",
  openaiKey: process.env.OPENAI_API_KEY,
  store: new DashyApiStore({
    baseUrl: process.env.DASHY_BASE_URL,
    token: process.env.DASHY_SDK_KEY,
  }),
});

const dashboard = await sdk.generate(source, options);
await sdk.deploy(dashboard, { refreshInterval: 300 });
// Now live at your Dashy instance
```

Get a `DASHY_SDK_KEY` from **Settings → API Keys** in the Dashy app.

---

## Express Middleware

Serve dashboards directly from an Express app:

```ts
import { reportMiddleware } from "@dashy/sdk/server";

app.use("/reports", reportMiddleware({ sdk, store }));
// GET /reports/:id       → renders the dashboard
// POST /reports/generate → generates + returns dashboard JSON
```

---

## Data Sources

| Source | Package | Notes |
|--------|---------|-------|
| PostgreSQL | `pg` (bundled) | Full schema introspection, FK detection |
| SQLite | `better-sqlite3` (bundled) | Local files |
| GraphQL | `graphql` (bundled) | Introspects via introspection query |

---

## License

MIT
