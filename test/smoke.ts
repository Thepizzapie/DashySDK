/**
 * Smoke test — no DB required, uses InlineConnector path via generateFromModel().
 * Run: npx tsx test/smoke.ts
 */

import { ReportSDK } from "../src/index.js";
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
        { name: "month",    label: "Month",    type: "string", nullable: false, isPrimaryKey: false, isForeignKey: false, role: "dimension" },
        { name: "product",  label: "Product",  type: "string", nullable: false, isPrimaryKey: false, isForeignKey: false, role: "dimension" },
        { name: "revenue",  label: "Revenue",  type: "number", nullable: false, isPrimaryKey: false, isForeignKey: false, role: "metric" },
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

const sdk = new ReportSDK({
  provider: "anthropic",
  anthropicKey: ANTHROPIC_KEY,
  publish: {
    baseUrl: "http://localhost:3000",
    secret: "smoke-test-secret-32-chars-minimum!",
    tokenTtl: 3600,
  },
});

// ── 3. Generate report ─────────────────────────────────────────────────────

console.log("Generating report via generateFromModel()…");

const report = await sdk.generateFromModel(
  model,
  {
    prompt: "Show monthly revenue by product as a bar chart with a summary table",
    mode: "charts",
    style: "light",
  },
  // Pass the sample rows as queryData so Claude has real data to plot
  { sales: model.entities[0].sample! as Record<string, unknown>[] }
);

console.log("\n── Report ──────────────────────────────────────────");
console.log("Title      :", report.title);
console.log("ID         :", report.id);
console.log("Created    :", report.createdAt.toISOString());
console.log("HTML length:", report.html.length, "chars");
console.log("\nFirst 300 chars of HTML:");
console.log(report.html.slice(0, 300));

// ── 4. Verify DOCTYPE ──────────────────────────────────────────────────────

if (!report.html.toLowerCase().includes("<!doctype")) {
  console.error("\n❌  FAIL: HTML does not contain <!DOCTYPE");
  process.exit(1);
}
console.log("\n✅  PASS: HTML contains <!DOCTYPE");

// ── 5. Publish + verify JWT + embed codes ──────────────────────────────────

console.log("\nPublishing report…");
const published = await sdk.publish(report);

console.log("\n── Published ───────────────────────────────────────");
console.log("ID         :", published.id);
console.log("URL        :", published.url);
console.log("Token      :", published.token.slice(0, 60) + "…");
console.log("Expires at :", published.expiresAt?.toISOString() ?? "never");
console.log("\niframe snippet:");
console.log(published.iframeCode);
console.log("\nscript snippet:");
console.log(published.scriptCode);

// Verify token is a valid JWT (3 base64url segments)
const parts = published.token.split(".");
if (parts.length !== 3) {
  console.error("\n❌  FAIL: token does not look like a JWT (expected 3 segments)");
  process.exit(1);
}
console.log("\n✅  PASS: token is a well-formed JWT");

// Verify embed codes contain the report ID
if (!published.iframeCode.includes(published.id) || !published.scriptCode.includes(published.id)) {
  console.error("\n❌  FAIL: embed codes do not reference the report ID");
  process.exit(1);
}
console.log("✅  PASS: embed codes reference the report ID");

// Verify the report is retrievable via list()
const listed = await sdk.list();
const found = listed.find(r => r.id === published.id);
if (!found) {
  console.error("\n❌  FAIL: published report not found in sdk.list()");
  process.exit(1);
}
console.log("✅  PASS: report appears in sdk.list()");

console.log("\n🎉  All smoke-test assertions passed.\n");
