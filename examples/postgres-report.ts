/**
 * Example: Generate a dashboard from a Postgres database and deploy it.
 *
 * Run: ANTHROPIC_API_KEY=... DATABASE_URL=... npx tsx examples/postgres-report.ts
 */
import { createSDK, MemoryDashboardStore } from "../src/index.js";

const sdk = createSDK({
  anthropicKey: process.env.ANTHROPIC_API_KEY!,
  store: new MemoryDashboardStore(),
});

console.log("🔍 Introspecting schema...");
const model = await sdk.introspect({
  type: "postgres",
  connectionString: process.env.DATABASE_URL!,
});

console.log(`📊 Found ${model.entities.length} entities:`);
model.entities.forEach(e => {
  console.log(`  - ${e.label} (${e.rowCount?.toLocaleString() ?? "?"} rows)`);
});

console.log("\n⚡ Generating dashboard...");
const dashboard = await sdk.generate(
  { type: "postgres", connectionString: process.env.DATABASE_URL! },
  {
    prompt: "Build a comprehensive analytics dashboard showing key metrics, trends, and breakdowns.",
    mode: "charts",
  }
);

console.log("\n✅ Dashboard generated!");
console.log("Title:", dashboard.title);
console.log("Mode :", dashboard.mode);
console.log("HTML :", dashboard.html_content.length.toLocaleString(), "chars");

// Deploy with live data enabled (5-minute refresh)
await sdk.deploy(dashboard, { refreshInterval: 300 });
console.log("\n🚀 Deployed with live data enabled.");
console.log("Dashboard ID:", dashboard.id);
