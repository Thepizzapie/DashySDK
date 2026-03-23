/**
 * Smoke test — no DB required, uses generateFromModel().
 * Run: ANTHROPIC_API_KEY=... npx tsx test/smoke.ts
 */

import { ReportSDK, MemoryDashboardStore } from "../src/index.js";
import type { SemanticModel } from "../src/index.js";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error("❌  ANTHROPIC_API_KEY is not set");
  process.exit(1);
}

// ── 1. Build a minimal inline semantic model ───────────────────────────────

const model: SemanticModel = {
  entities: [
    {
      name: "sales",
      label: "Sales",
      sourceName: "sales",
      columns: [
        { name: "month",   label: "Month",   type: "string", nullable: false, isPrimaryKey: false, isForeignKey: false, role: "dimension" },
        { name: "product", label: "Product", type: "string", nullable: false, isPrimaryKey: false, isForeignKey: false, role: "dimension" },
        { name: "revenue", label: "Revenue", type: "number", nullable: false, isPrimaryKey: false, isForeignKey: false, role: "metric" },
      ],
      rowCount: 6,
      sample: [
        { month: "Jan", product: "Widget A", revenue: 12000 },
        { month: "Jan", product: "Widget B", revenue:  8500 },
        { month: "Feb", product: "Widget A", revenue: 15200 },
        { month: "Feb", product: "Widget B", revenue:  9100 },
        { month: "Mar", product: "Widget A", revenue: 18400 },
        { month: "Mar", product: "Widget B", revenue: 11300 },
      ],
    },
  ],
  relationships: [],
  metrics: [
    {
      name: "total_revenue",
      label: "Total Revenue",
      expression: "SUM(revenue)",
      entity: "sales",
      aggregation: "sum",
      format: "currency",
    },
  ],
  source: { type: "inline", name: "smoke-test" },
};

// ── 2. Instantiate SDK ─────────────────────────────────────────────────────

const store = new MemoryDashboardStore();
const sdk = new ReportSDK({ provider: "anthropic", anthropicKey: ANTHROPIC_KEY, store });

// ── 3. Generate dashboard ──────────────────────────────────────────────────

console.log("Generating dashboard via generateFromModel()…");

const dashboard = await sdk.generateFromModel(
  model,
  { prompt: "Show monthly revenue by product as a bar chart with a summary table", mode: "charts" },
  { sales: model.entities[0].sample! as Record<string, unknown>[] }
);

console.log("\n── Dashboard ───────────────────────────────────────");
console.log("Title      :", dashboard.title);
console.log("ID         :", dashboard.id);
console.log("Mode       :", dashboard.mode);
console.log("Created    :", dashboard.created_at.toISOString());
console.log("HTML length:", dashboard.html_content.length, "chars");

// ── 4. Verify DOCTYPE ──────────────────────────────────────────────────────

if (!dashboard.html_content.toLowerCase().includes("<!doctype")) {
  console.error("\n❌  FAIL: HTML does not contain <!DOCTYPE");
  process.exit(1);
}
console.log("\n✅  PASS: HTML contains <!DOCTYPE");

// ── 5. Verify sentinel markers present (live data architecture) ────────────

const hasSentinels = /DASHY_DATA:/.test(dashboard.html_content);
console.log(`\n${hasSentinels ? "✅" : "⚠️ "}  Sentinel markers: ${hasSentinels ? "present" : "none (inline mode — expected)"}`);

// ── 6. Publish + verify store ──────────────────────────────────────────────

console.log("\nPublishing dashboard…");
await sdk.publish(dashboard);

const listed = await sdk.list();
const found = listed.find(d => d.id === dashboard.id);
if (!found) {
  console.error("\n❌  FAIL: published dashboard not found in sdk.list()");
  process.exit(1);
}
console.log("✅  PASS: dashboard appears in sdk.list()");
console.log(`   sdk.list() returned ${listed.length} dashboard(s)`);

console.log("\n🎉  All smoke-test assertions passed.\n");
