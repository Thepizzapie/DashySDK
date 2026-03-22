# @dashy/sdk

Generate beautiful, embeddable HTML reports from any data source using Claude AI.

## Install

```bash
npm install @dashy/sdk
```

## Quick start

```ts
import { createSDK } from "@dashy/sdk";

const sdk = createSDK({
  anthropicKey: process.env.ANTHROPIC_API_KEY!,
  publish: {
    baseUrl: "https://yourapp.com",
    secret: process.env.REPORT_SECRET!,
  },
});

// Generate + publish in one call
const published = await sdk.generateAndPublish(
  { type: "postgres", connectionString: process.env.DATABASE_URL! },
  { prompt: "Monthly revenue by product line", mode: "charts", style: "dark" }
);

console.log(published.url);       // https://yourapp.com/reports/rpt_xxx?token=...
console.log(published.iframeCode); // ready-to-paste <iframe>
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

## Report modes

| Mode | Description |
|------|-------------|
| `charts` | Multi-chart analytics dashboard (Recharts) |
| `table` | Sortable data table with search + pagination |
| `infographic` | Visual one-pager — big numbers, progress bars |
| `executive` | KPI cards + one main chart + bullet takeaways |

## Embedding in Express

```ts
import express from "express";
import { createSDK, reportMiddleware } from "@dashy/sdk";

const sdk = createSDK({ anthropicKey: "...", publish: { baseUrl: "...", secret: "..." } });

const app = express();
app.use("/reports", reportMiddleware({ publisher: sdk["publisher"] }));
```

## Embedding in React

```tsx
import { ReportFrame } from "@dashy/sdk/react";

<ReportFrame
  reportId={published.id}
  token={published.token}
  baseUrl="https://yourapp.com"
  height={500}
/>
```

## Streaming generation

```ts
for await (const event of sdk.stream(source, options)) {
  if (event.type === "delta") process.stdout.write(event.text);
  if (event.type === "done") console.log("Report:", event.report.title);
}
```

## Custom store

Implement `ReportStore` to persist reports in your own database:

```ts
import type { ReportStore, Report } from "@dashy/sdk";

class MyDbStore implements ReportStore {
  async save(report: Report) { await db.insert(report); }
  async get(id: string) { return db.findById(id); }
  async list() { return db.findAll(); }
  async delete(id: string) { await db.delete(id); }
}

const sdk = createSDK({
  anthropicKey: "...",
  publish: { baseUrl: "...", secret: "...", store: new MyDbStore() },
});
```
