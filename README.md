# @dashy/sdk

Generate embeddable HTML dashboards from any data source using Claude AI.

## Install

```bash
npm install @dashy/sdk
```

## Quick start

```ts
import { createSDK, MemoryDashboardStore } from "@dashy/sdk";

const sdk = createSDK({
  anthropicKey: process.env.ANTHROPIC_API_KEY!,
  store: new MemoryDashboardStore(),
});

// Generate a dashboard
const dashboard = await sdk.generate(
  { type: "postgres", connectionString: process.env.DATABASE_URL! },
  { prompt: "Monthly revenue by product line", mode: "charts" }
);

console.log(dashboard.title);          // "Revenue by Product Line"
console.log(dashboard.html_content);   // full HTML document

// Publish to store and enable live data (5-min refresh)
await sdk.deploy(dashboard, { refreshInterval: 300 });
```

## Data sources

### PostgreSQL

```ts
{ type: "postgres", connectionString: "postgresql://...", include: ["orders", "products"] }
```

### GraphQL

```ts
{ type: "graphql", endpoint: "https://api.example.com/graphql", headers: { Authorization: "Bearer ..." } }
```

### Inline (pre-built model)

```ts
{ type: "inline", model: mySemanticModel }
```

## Dashboard modes

| Mode | Description |
|------|-------------|
| `charts` | Multi-chart analytics dashboard (Recharts) |
| `mui` | Material UI data-rich layout with tables and KPIs |
| `html` | Plain HTML document — no React, fully portable |
| `infographic` | Visual one-pager — big numbers, progress bars |
| `diagram` | D3/SVG entity relationship or flow diagram |

## Streaming generation

```ts
for await (const event of sdk.stream(source, options)) {
  if (event.type === "delta") process.stdout.write(event.text);
  if (event.type === "done") console.log("Done:", event.dashboard.title);
}
```

## Introspect schema first

```ts
const model = await sdk.introspect({ type: "postgres", connectionString: "..." });
console.log(model.entities.map(e => e.name));
```

## Generate from a pre-built model

```ts
const dashboard = await sdk.generateFromModel(model, { prompt: "...", mode: "charts" }, queryData);
```

## Express middleware

```ts
import express from "express";
import { createSDK, MemoryDashboardStore, reportMiddleware } from "@dashy/sdk";

const store = new MemoryDashboardStore();
const sdk = createSDK({ anthropicKey: "...", store });

const app = express();
app.use("/reports", reportMiddleware({ store }));
```

## Custom store

Implement `DashboardStore` to persist dashboards in your own database:

```ts
import type { DashboardStore, Dashboard } from "@dashy/sdk";

class MyDbStore implements DashboardStore {
  async save(dashboard: Dashboard) { await db.upsert(dashboard); }
  async get(id: string) { return db.findById(id); }
  async list() { return db.findAll(); }
  async delete(id: string) { await db.delete(id); }
}

const sdk = createSDK({ anthropicKey: "...", store: new MyDbStore() });
```

## OpenAI provider

```ts
const sdk = createSDK({ provider: "openai", openaiKey: process.env.OPENAI_API_KEY! });
```
