# @dashy/sdk

Generate embeddable, live-updating dashboards from any database using AI.

Point the SDK at a Postgres, SQLite, or GraphQL data source, describe what you want in plain English, and get back a self-contained HTML dashboard. Embed it in an iframe on your app and push live data to it via postMessage — charts update instantly without a page reload.

---

## Prerequisites

- Node.js 18+
- An OpenAI or Anthropic API key
- A Postgres, SQLite, or GraphQL data source

---

## Setup

```bash
# 1. Install
npm install @dashy/sdk

# 2. Set your API key
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Generating Your First Dashboard

```ts
// generate.ts
import { createSDK } from "@dashy/sdk";
import { writeFileSync } from "fs";

const sdk = createSDK({
  provider: "openai",                        // or "anthropic"
  openaiKey: process.env.OPENAI_API_KEY,
});

const dashboard = await sdk.generate(
  {
    type: "postgres",
    connectionString: process.env.DATABASE_URL, // e.g. postgres://user:pass@host:5432/db
  },
  {
    prompt: "Monthly revenue, order count, and average order value for the past year",
    mode: "charts",      // "charts" | "mui" | "diagram"
    entities: ["orders"], // which tables to use (optional — defaults to all)
    dataLimit: 200,       // rows per table sent to AI (optional)
  }
);

// dashboard.html_content is a complete, self-contained HTML file
writeFileSync("dashboard.html", dashboard.html_content);
console.log("Saved to dashboard.html — open it in a browser");
```

```bash
npx tsx generate.ts
```

That's it. Open `dashboard.html` directly in a browser — it works standalone.

---

## Embedding in Your App

Dashboards are designed to run inside an iframe. Use `prepareDoc` to make the HTML iframe-safe:

```ts
// server.ts (Express example)
import express from "express";
import { createSDK, prepareDoc } from "@dashy/sdk";

const app = express();
const sdk = createSDK({ provider: "openai", openaiKey: process.env.OPENAI_API_KEY });

// Generate once and cache the HTML
let cachedHtml: string | null = null;

app.get("/dashboard/frame", async (req, res) => {
  if (!cachedHtml) {
    const dashboard = await sdk.generate(
      { type: "postgres", connectionString: process.env.DATABASE_URL },
      { prompt: "Revenue trends for the past 12 months", mode: "charts" }
    );
    cachedHtml = prepareDoc(dashboard.html_content);
  }
  res.send(cachedHtml);
});

app.listen(3000);
```

```html
<!-- In your frontend -->
<iframe
  src="/dashboard/frame"
  sandbox="allow-scripts allow-same-origin"
  style="width: 100%; height: 600px; border: none;"
></iframe>
```

---

## Live Data (Push Updates Without Reloading)

Dashboards use a `useDashyData(key, fallback)` hook internally. You can push fresh rows to it from the parent page at any time.

### Step 1 — Find the data keys your dashboard uses

```ts
import { extractSentinelKeys } from "@dashy/sdk";

const keys = extractSentinelKeys(dashboard.html_content);
// e.g. ["orders"]
```

### Step 2 — Push data via postMessage

```ts
const iframe = document.getElementById("my-dashboard") as HTMLIFrameElement;

// Call this whenever you want to refresh the dashboard data
function pushLiveData(rows: object[]) {
  iframe.contentWindow!.postMessage({
    type: "DASHY_UPDATE",
    data: { orders: rows }   // key must match extractSentinelKeys output
  }, "*");
}

// Example: push fresh data every 30 seconds
setInterval(async () => {
  const rows = await fetch("/api/orders/recent").then(r => r.json());
  pushLiveData(rows);
}, 30_000);
```

> **Send raw rows** — the same shape as your database table. The dashboard handles all aggregation (monthly rollups, bucketing, totals) in the browser. Do **not** pre-aggregate.

---

## `generate` vs `stream`

They work differently under the hood:

- **`generate`** runs a **multi-step pipeline** — planner → visualizer → inspector/critic → refiner. Higher quality output, multiple LLM calls, slower.
- **`stream`** is a **single LLM call** that streams tokens directly as they arrive, then yields a final `done` with the complete `Dashboard`. Faster, no refinement pass.

```ts
// generate — multi-step pipeline, resolves with final Dashboard
const dashboard = await sdk.generate(source, options);

// stream — single LLM call, yields token deltas then done
for await (const chunk of sdk.stream(source, options)) {
  if (chunk.type === "delta") process.stdout.write(chunk.text); // live preview
  if (chunk.type === "done") console.log(chunk.dashboard.title);
}
```

Use `generate` when output quality matters. Use `stream` when you want live preview or faster results.

---

## Generation Modes

| Mode | Stack | Style | Best for |
|------|-------|-------|----------|
| `charts` | Recharts + MUI | Dark, glassmorphic | Analytics, KPI dashboards |
| `mui` | MUI components | Dark, structured | Data overviews, admin panels |
| `diagram` *(experimental)* | D3 + hand-crafted SVG | Academic, white bg | Methodology flows, statistical figures |

---

## Exposing Dashboard Generation to End Users

If you want your own users to generate and view dashboards — not just you — wrap the SDK in a backend API. Users never touch the SDK, LLM keys, or database connections directly.

### The Pattern

```
User browser  →  POST /api/dashboards  (authed)  →  SDK (server-side)  →  stored HTML in DB
User browser  →  <iframe src="/api/dashboards/:id/frame">  →  DB lookup  →  prepareDoc HTML
User browser  →  fetch your data  →  postMessage to iframe  →  charts update
```

### 1. Generation endpoint

```ts
// POST /api/dashboards
// Body: { prompt: string, mode?: string }
app.post("/api/dashboards", requireAuth, rateLimitPerUser, async (req, res) => {
  const { prompt, mode = "charts" } = req.body;

  const dashboard = await sdk.generate(
    { type: "postgres", connectionString: process.env.DATABASE_URL }, // your DB, not the user's
    { prompt, mode }
  );

  const id = crypto.randomUUID();
  await db.dashboards.insert({ id, userId: req.user.id, html: dashboard.html_content });

  res.json({ id });
});
```

Key rules:
- **Rate limit this route** — each call makes multiple LLM requests and costs money
- **Use your own DB connection** — never accept a connection string from the client
- **Validate `prompt`** before passing to the SDK

### 2. Frame serving endpoint

```ts
// GET /api/dashboards/:id/frame
app.get("/api/dashboards/:id/frame", requireAuth, async (req, res) => {
  const row = await db.dashboards.findOne({ id: req.params.id, userId: req.user.id });
  if (!row) return res.status(404).end();

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(prepareDoc(row.html));
});
```

### 3. Frontend

```tsx
// After calling POST /api/dashboards and getting back { id }
const [dashboardId, setDashboardId] = useState<string | null>(null);
const iframeRef = useRef<HTMLIFrameElement>(null);

// Push live data whenever your data changes
useEffect(() => {
  const rows = await fetch("/api/orders/recent").then(r => r.json());
  iframeRef.current?.contentWindow?.postMessage(
    { type: "DASHY_UPDATE", data: { orders: rows } },
    "*"
  );
}, [liveData]);

return dashboardId ? (
  <iframe
    ref={iframeRef}
    src={`/api/dashboards/${dashboardId}/frame`}
    sandbox="allow-scripts allow-same-origin"
    style={{ width: "100%", height: 600, border: "none" }}
  />
) : null;
```

### Hosting options

| Option | How | Best for |
|--------|-----|----------|
| **Self-hosted** | Store HTML in your DB, serve from your API | Full control, any stack |
| **Dashy backend** | `DashyApiStore` + `sdk.deploy()` | Managed hosting, CDN, auto-refresh |
| **Blob storage** | Write `prepareDoc(html)` to S3/R2, serve from CDN | Static/read-heavy dashboards |

---

## Publish to the Dashy App

If you're using the Dashy app as a backend, get an SDK key from **Settings → API Keys**, then:

```ts
import { createSDK } from "@dashy/sdk";
import { DashyApiStore } from "@dashy/sdk/publish";

const sdk = createSDK({
  provider: "openai",
  openaiKey: process.env.OPENAI_API_KEY,
  store: new DashyApiStore({
    baseUrl: process.env.DASHY_BASE_URL,  // e.g. https://app.dashy.com
    token: process.env.DASHY_SDK_KEY,
  }),
});

const dashboard = await sdk.generate(source, options);

// Save to Dashy and enable live refresh every 5 minutes
await sdk.deploy(dashboard, { refreshInterval: 300 });

console.log("Live at:", `${process.env.DASHY_BASE_URL}/dashboard/${dashboard.id}`);
```

---

## Full API Reference

### `createSDK(config)` → `ReportSDK`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | `"openai" \| "anthropic"` | `"anthropic"` | AI provider |
| `openaiKey` | `string` | — | Required if provider is `"openai"` |
| `anthropicKey` | `string` | — | Required if provider is `"anthropic"` |
| `store` | `DashboardStore` | — | Optional persistence (Dashy, memory, etc.) |

---

### `sdk.generate(source, options)` → `Promise<Dashboard>`
### `sdk.stream(source, options)` → `AsyncGenerator`

**Source options:**
```ts
{ type: "postgres"; connectionString: string; sampleSize?: number }
{ type: "sqlite";   path: string }
{ type: "graphql";  endpoint: string; headers?: Record<string, string> }
```

**Generation options:**
```ts
{
  prompt: string;                          // what to build
  mode?: "charts" | "mui" | "diagram";    // default: "charts"
  entities?: string[];                    // tables to use (default: all)
  dataLimit?: number;                     // rows per table (default: 200)
  data?: Record<string, Row[]>;           // pre-fetched rows (skips auto-query)
}
```

---

### `sdk.introspect(source)` → `Promise<SemanticModel>`

Preview tables, columns, row counts, and relationships before generating.

---

### `sdk.deploy(dashboard, options?)` → `Promise<Dashboard>`

Enable live data and save. Requires a `store` in config.

```ts
await sdk.deploy(dashboard, {
  refreshInterval?: number,    // seconds (default: 300)
  sourceBindings?: string[],   // override which entity names are live
});
```

---

### `prepareDoc(html)` → `string`

Makes raw generated HTML safe for iframe embedding. Injects the DASHY bootstrap (postMessage listener + `useDashyData`), strips duplicates, removes any broken chart children.

---

### `extractSentinelKeys(html)` → `string[]`

Returns entity key names used in a dashboard. Use these as the `data` keys when calling postMessage.

---

## Data Sources

| Source | Notes |
|--------|-------|
| PostgreSQL | Full schema introspection, FK detection, row counts |
| SQLite | Works with local `.sqlite` / `.db` files |
| GraphQL | Introspects via standard introspection query |

All required packages (`pg`, `better-sqlite3`, `graphql`) are bundled.

---

## License

MIT
