/**
 * Stress test — Postgres connector against a large e-commerce dataset.
 * Tables: customers(100k), products(500), orders(1M), order_items(3M), events(2M)
 *
 * Run: ANTHROPIC_API_KEY=... npx tsx test/stress.ts
 *      OPENAI_API_KEY=...    npx tsx test/stress.ts --provider openai
 */

import { ReportSDK, MemoryDashboardStore } from "../src/index.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "output");
mkdirSync(OUT, { recursive: true });

function save(name: string, html: string) {
  writeFileSync(join(OUT, `${name}.html`), html);
  console.log(`  Saved → test/output/${name}.html`);
}


const CONNECTION = "postgresql://stress:stress@localhost:5434/stressdb";

const providerArg = process.argv.includes("--provider")
  ? process.argv[process.argv.indexOf("--provider") + 1]
  : "anthropic";

if (providerArg !== "anthropic" && providerArg !== "openai") {
  console.error("--provider must be 'anthropic' or 'openai'"); process.exit(1);
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY    = process.env.OPENAI_API_KEY;

if (providerArg === "anthropic" && !ANTHROPIC_KEY) { console.error("ANTHROPIC_API_KEY not set"); process.exit(1); }
if (providerArg === "openai"    && !OPENAI_KEY)    { console.error("OPENAI_API_KEY not set");    process.exit(1); }

console.log(`Provider: ${providerArg}`);

const store = new MemoryDashboardStore();

const sdk = new ReportSDK({
  provider: providerArg as "anthropic" | "openai",
  anthropicKey: ANTHROPIC_KEY,
  openaiKey: OPENAI_KEY,
  store,
});

const source = {
  type: "postgres" as const,
  connectionString: CONNECTION,
  sampleSize: 10,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function hrt() { return Number(process.hrtime.bigint()) / 1e6; }
function ms(start: number) { return `${(hrt() - start).toFixed(0)} ms`; }
function sep(label: string) { console.log(`\n${"─".repeat(60)}\n  ${label}\n${"─".repeat(60)}`); }
function pass(msg: string) { console.log(`✅  ${msg}`); }
function fail(msg: string) { console.error(`❌  ${msg}`); process.exitCode = 1; }

// OpenAI free tier caps at 30k TPM — reduce rows sent to avoid 429s
const dataLimit = providerArg === "openai" ? 50 : 200;

// ── Test 1: Introspection ─────────────────────────────────────────────────────

sep("TEST 1 — Schema introspection (6 tables, 6.1M rows)");
let t = hrt();
const model = await sdk.introspect(source);
const introMs = hrt() - t;
console.log(`  Introspected in ${introMs.toFixed(0)} ms`);
console.log(`  Entities : ${model.entities.map(e => `${e.name}(~${(e.rowCount ?? 0).toLocaleString()})`).join(", ")}`);
console.log(`  Metrics  : ${model.metrics.length}`);
console.log(`  Relations: ${model.relationships.length}`);

if (model.entities.length >= 5) pass(`Found ${model.entities.length} entities`); else fail("Expected ≥5 entities");
if (introMs < 5000) pass(`Introspection < 5s`); else fail(`Introspection too slow: ${introMs.toFixed(0)} ms`);

// ── Test 2: Revenue trend (charts mode → JSX snippet) ─────────────────────────

sep("TEST 2 — Revenue trend, charts mode (orders 1M rows)");
t = hrt();
const revenueDash = await sdk.generate(source, {
  prompt: "Why did revenue drop last month? Show me month by month for the past year — total revenue, number of orders, and average order size. I want to see if it's a volume problem or an AOV problem.",
  mode: "charts",
  entities: ["orders"],
  dataLimit,
});
console.log(`  Generated in ${ms(t)}`);
console.log(`  Title      : ${revenueDash.title}`);
console.log(`  html_content length: ${revenueDash.html_content.length.toLocaleString()} chars`);
console.log(`  mode       : ${revenueDash.mode}`);

save(`${providerArg}-revenue-charts`, revenueDash.html_content);
if (revenueDash.html_content.length > 500) pass("html_content non-trivial");
else fail("html_content suspiciously short");
if (revenueDash.mode === "charts") pass("mode = charts");
else fail(`Expected mode=charts, got ${revenueDash.mode}`);

// ── Test 3: MUI dashboard ─────────────────────────────────────────────────────

sep("TEST 3 — Customer segmentation, mui mode (100k customers)");
t = hrt();
const custDash = await sdk.generate(source, {
  prompt: "Give me a full customer breakdown. Who are our best customers? Which countries are growing? Show plan tier distribution, top 10 countries by customer count, and highlight anyone with high LTV.",
  mode: "mui",
  entities: ["customers"],
  dataLimit,
});
console.log(`  Generated in ${ms(t)}`);
console.log(`  Title: ${custDash.title}`);
console.log(`  mode : ${custDash.mode}`);

save(`${providerArg}-customer-mui`, custDash.html_content);
if (custDash.html_content.length > 500) pass("html_content non-trivial");
else fail("html_content suspiciously short");
if (custDash.mode === "mui") pass("mode = mui"); else fail(`Expected mode=mui, got ${custDash.mode}`);

// ── Test 4: Product performance (all 6 tables) ────────────────────────────────

sep("TEST 4 — Product performance, html mode (all 6 tables)");
t = hrt();
const prodDash = await sdk.generate(source, {
  prompt: "What's selling and what's not? I need our top 20 products by revenue, a category breakdown, and a flag on anything that's underperforming. Make it easy to scan.",
  mode: "html",
  dataLimit,
});
console.log(`  Generated in ${ms(t)}`);
console.log(`  Title: ${prodDash.title}`);

save(`${providerArg}-products-html`, prodDash.html_content);
if (prodDash.html_content.toLowerCase().includes("<!doctype")) pass("html mode includes <!DOCTYPE");
else fail("html mode missing <!DOCTYPE");

// ── Test 5: Save to store & list ──────────────────────────────────────────────

sep("TEST 5 — Save 3 dashboards to MemoryDashboardStore");
t = hrt();
await Promise.all([
  sdk.publish(revenueDash),
  sdk.publish(custDash),
  sdk.publish(prodDash),
]);
console.log(`  Saved in ${ms(t)}`);

const listed = await sdk.list();
if (listed.length === 3) pass("sdk.list() returns 3 dashboards");
else fail(`Expected 3, got ${listed.length}`);

for (const d of listed) {
  const hasId    = d.id.startsWith("dash_");
  const hasMode  = ["html","mui","charts","infographic","diagram"].includes(d.mode);
  const hasHtml  = d.html_content.length > 0;
  if (hasId && hasMode && hasHtml) pass(`${d.id} (${d.mode}) — id ✓  mode ✓  html_content ✓`);
  else fail(`${d.id} — id=${hasId} mode=${hasMode} html=${hasHtml}`);
}

// ── Test 6: Streaming (infographic mode) ──────────────────────────────────────

sep("TEST 6 — Streaming, infographic mode (orders 1M rows)");
t = hrt();
let deltaCount = 0;
let streamedDash;
for await (const chunk of sdk.stream(source, {
  prompt: "Tell the story of our order volume over the past 6 months. Are we growing? Where are the dips? What's the cancellation rate doing? Make it feel like a magazine feature, not a spreadsheet.",
  mode: "infographic",
  entities: ["orders"],
  dataLimit: providerArg === "openai" ? 30 : 100,
})) {
  if (chunk.type === "delta") deltaCount++;
  if (chunk.type === "done")  streamedDash = chunk.dashboard;
}
console.log(`  Streamed in ${ms(t)} — ${deltaCount} deltas`);
console.log(`  Title: ${streamedDash?.title}`);

if (deltaCount > 5) pass(`Received ${deltaCount} streaming deltas`);
else fail(`Too few deltas: ${deltaCount}`);
if (streamedDash) save(`${providerArg}-orders-infographic`, streamedDash.html_content);
if ((streamedDash?.html_content.length ?? 0) > 500) pass("Streamed html_content non-trivial");
else fail("Streamed html_content missing or empty");

// ── Test 7: Diagram mode ──────────────────────────────────────────────────────

sep("TEST 7 — Diagram mode, entity-relationship (all 6 tables)");
t = hrt();
const diagramDash = await sdk.generate(source, {
  prompt: "Show me how this database is structured. What connects to what? I want to understand the relationships between customers, orders, and products at a glance.",
  mode: "diagram",
  dataLimit: providerArg === "openai" ? 20 : 50,
});
console.log(`  Generated in ${ms(t)}`);
console.log(`  Title: ${diagramDash.title}`);
console.log(`  html_content length: ${diagramDash.html_content.length.toLocaleString()} chars`);

save(`${providerArg}-schema-diagram`, diagramDash.html_content);
if (diagramDash.html_content.toLowerCase().includes("<!doctype")) pass("diagram includes <!DOCTYPE");
else fail("diagram missing <!DOCTYPE");
if (diagramDash.html_content.includes("d3") || diagramDash.html_content.includes("<svg")) pass("diagram uses D3 or SVG");
else fail("diagram missing D3/SVG content");
if (diagramDash.mode === "diagram") pass("mode = diagram"); else fail(`Expected mode=diagram, got ${diagramDash.mode}`);

// ── Summary ───────────────────────────────────────────────────────────────────

sep("SUMMARY");
if (process.exitCode) {
  console.log("Some tests FAILED — see ❌ above");
} else {
  console.log("🎉  All stress-test assertions passed.");
}
