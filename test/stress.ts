/**
 * Stress test — Postgres connector against a large e-commerce dataset.
 * Tables: customers(100k), products(500), orders(1M), order_items(3M), events(2M)
 *
 * Run: OPENAI_API_KEY=... DASHY_SDK_KEY=dashy_v1_... npx tsx test/stress.ts --provider openai
 */

import { ReportSDK, MemoryDashboardStore } from "../src/index.js";
import { DashyApiStore } from "../src/publish/dashy-api-store.js";
import type { Dashboard } from "../src/types.js";
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

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY     = process.env.OPENAI_API_KEY;
const DASHY_SDK_KEY  = process.env.DASHY_SDK_KEY;
const DASHY_BASE_URL = process.env.DASHY_BASE_URL ?? "http://localhost:3001";

if (providerArg === "anthropic" && !ANTHROPIC_KEY) { console.error("ANTHROPIC_API_KEY not set"); process.exit(1); }
if (providerArg === "openai"    && !OPENAI_KEY)    { console.error("OPENAI_API_KEY not set");    process.exit(1); }

// ── Helpers ────────────────────────────────────────────────────────────────────

function hrt() { return Number(process.hrtime.bigint()) / 1e6; }
function ms(start: number) { return `${(hrt() - start).toFixed(0)} ms`; }
function sep(label: string) { console.log(`\n${"─".repeat(60)}\n  ${label}\n${"─".repeat(60)}`); }
function pass(msg: string) { console.log(`✅  ${msg}`); }
function fail(msg: string, err?: unknown) {
  console.error(`❌  ${msg}${err ? `: ${(err as Error).message ?? err}` : ""}`);
  process.exitCode = 1;
}

const source = { type: "postgres" as const, connectionString: CONNECTION, sampleSize: 10 };
// OpenAI has tighter TPM limits — keep prompt data smaller
const dataLimit = providerArg === "openai" ? 50 : 200;

// ── STEP 0: Introspect schema ──────────────────────────────────────────────────

sep("STEP 0 — Schema introspection");
let t = hrt();

// Temporary SDK (no store) just for introspection
const introspectSdk = new ReportSDK({
  provider: providerArg as "anthropic" | "openai",
  anthropicKey: ANTHROPIC_KEY,
  openaiKey: OPENAI_KEY,
});

const model = await introspectSdk.introspect(source);
console.log(`  Introspected in ${(hrt() - t).toFixed(0)} ms`);
console.log(`  Entities : ${model.entities.map(e => `${e.name}(${(e.rowCount ?? 0).toLocaleString()})`).join(", ")}`);

if (model.entities.length >= 5) pass(`Found ${model.entities.length} entities`);
else { fail("Expected ≥5 entities"); process.exit(1); }

// ── STEP 1: Register stressdb tables as dashy data sources → sourceIdMap ─────

let sourceIdMap: Record<string, string> = {};

if (DASHY_SDK_KEY) {
  sep("STEP 1 — Register stressdb tables as dashy data sources");

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${DASHY_SDK_KEY}`,
  };

  // Fetch existing sources — skip creating ones that already exist by name
  let existing: Array<{ id: string; name: string }> = [];
  try {
    const r = await fetch(`${DASHY_BASE_URL}/api/sources`, { headers: authHeaders });
    if (r.ok) existing = await r.json();
  } catch (_) {}

  const existingByName = new Map(existing.map(s => [s.name.toLowerCase(), s.id]));

  for (const entity of model.entities) {
    if (entity.rowCount === -1) continue; // skip if count unknown (categories had -1)

    // Use exact entity name as source name so dashy's auto-detection matches
    // sentinel markers (/*DASHY_DATA:orders*/ etc.) to registered sources
    const sourceName = entity.name;
    const existingId = existingByName.get(sourceName.toLowerCase());

    if (existingId) {
      sourceIdMap[entity.name] = existingId;
      console.log(`  Reused  : ${sourceName} (${existingId})`);
      continue;
    }

    try {
      const res = await fetch(`${DASHY_BASE_URL}/api/sources`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: sourceName,
          type: "db",
          db_type: "postgres",
          config: { connection_string: CONNECTION },
          db_query: `SELECT * FROM "${entity.sourceName ?? entity.name}" LIMIT 5000`,
        }),
      });
      if (res.ok) {
        const body = await res.json();
        const id = body.source?.id ?? body.id;
        if (id) {
          sourceIdMap[entity.name] = id;
          console.log(`  Created : ${sourceName} (${id})`);
        } else {
          console.log(`  Created ${sourceName} but response had no id:`, JSON.stringify(body).slice(0, 120));
        }
      } else {
        const err = await res.json().catch(() => ({}));
        console.log(`  Failed  : ${sourceName} — HTTP ${res.status}: ${(err as any).error ?? "unknown"}`);
      }
    } catch (err) {
      console.log(`  Error   : ${sourceName} — ${(err as Error).message}`);
    }
  }

  console.log(`  Source map (${Object.keys(sourceIdMap).length} entries): ${JSON.stringify(sourceIdMap)}`);
}

// ── STEP 2: Build SDK with configured store ────────────────────────────────────

const store = DASHY_SDK_KEY
  ? new DashyApiStore({ baseUrl: DASHY_BASE_URL, token: DASHY_SDK_KEY, sourceIdMap })
  : new MemoryDashboardStore();

const sdk = new ReportSDK({
  provider: providerArg as "anthropic" | "openai",
  anthropicKey: ANTHROPIC_KEY,
  openaiKey: OPENAI_KEY,
  store,
});

console.log(`\nProvider : ${providerArg}`);
console.log(`Store    : ${DASHY_SDK_KEY ? `DashyApiStore → ${DASHY_BASE_URL}` : "MemoryDashboardStore"}`);
console.log(`Sources  : ${Object.keys(sourceIdMap).length} entity→source mappings`);

// Helper: stream a dashboard and print progress dots
async function streamDash(
  prompt: string,
  mode: "charts" | "mui" | "html" | "infographic" | "diagram",
  entities?: string[],
  limit = dataLimit
): Promise<Dashboard> {
  let deltas = 0;
  let result: Dashboard | undefined;
  process.stdout.write("  Streaming ");
  for await (const chunk of sdk.stream(source, { prompt, mode, entities, dataLimit: limit })) {
    if (chunk.type === "delta") { deltas++; if (deltas % 20 === 0) process.stdout.write("."); }
    if (chunk.type === "done")  result = chunk.dashboard;
  }
  process.stdout.write(` (${deltas} deltas)\n`);
  if (!result) throw new Error("Stream ended without a done chunk");
  return result;
}

// Helper: deploy a finished dashboard and print the URL
async function deployDash(dash: Dashboard, label: string): Promise<void> {
  await sdk.deploy(dash, { refreshInterval: 300 });
  if (DASHY_SDK_KEY) {
    console.log(`  ✓ Deployed ${label}: ${DASHY_BASE_URL}/dashboard/${dash.id}`);
  }
}

// ── TEST 2: Revenue trend — charts mode, streamed ─────────────────────────────

sep("TEST 2 — Revenue trend, charts mode (stream)");
t = hrt();
let revenueDash: Dashboard | undefined;
try {
  revenueDash = await streamDash(
    "Why did revenue drop last month? Show me month by month for the past year — total revenue, number of orders, and average order size. I want to see if it's a volume problem or an AOV problem.",
    "charts",
    ["orders"]
  );
  console.log(`  Done in ${ms(t)} — ${revenueDash.html_content.length.toLocaleString()} chars`);
  console.log(`  Title: ${revenueDash.title}`);
  save(`${providerArg}-revenue-charts`, revenueDash.html_content);
  if (revenueDash.html_content.length > 500) pass("html_content non-trivial");
  else fail("html_content suspiciously short");
  if (revenueDash.mode === "charts") pass("mode = charts");
  else fail(`Expected mode=charts, got ${revenueDash.mode}`);
} catch (err) {
  fail("TEST 2 threw", err);
}

// ── TEST 3: Customer segmentation — mui mode, streamed ────────────────────────

sep("TEST 3 — Customer segmentation, mui mode (stream)");
t = hrt();
let custDash: Dashboard | undefined;
try {
  custDash = await streamDash(
    "Give me a full customer breakdown. Who are our best customers? Which countries are growing? Show plan tier distribution, top 10 countries by customer count, and highlight anyone with high LTV.",
    "mui",
    ["customers"]
  );
  console.log(`  Done in ${ms(t)} — ${custDash.html_content.length.toLocaleString()} chars`);
  console.log(`  Title: ${custDash.title}`);
  save(`${providerArg}-customer-mui`, custDash.html_content);
  if (custDash.html_content.length > 500) pass("html_content non-trivial");
  else fail("html_content suspiciously short");
  if (custDash.mode === "mui") pass("mode = mui");
  else fail(`Expected mode=mui, got ${custDash.mode}`);
} catch (err) {
  fail("TEST 3 threw", err);
}

// ── TEST 4: Product performance — html mode, streamed ────────────────────────

sep("TEST 4 — Product performance, html mode (stream)");
t = hrt();
let prodDash: Dashboard | undefined;
try {
  prodDash = await streamDash(
    "What's selling and what's not? I need our top 20 products by revenue, a category breakdown, and a flag on anything that's underperforming. Make it easy to scan.",
    "html"
  );
  console.log(`  Done in ${ms(t)} — ${prodDash.html_content.length.toLocaleString()} chars`);
  console.log(`  Title: ${prodDash.title}`);
  save(`${providerArg}-products-html`, prodDash.html_content);
  if (prodDash.html_content.toLowerCase().includes("<!doctype")) pass("html mode includes <!DOCTYPE");
  else fail("html mode missing <!DOCTYPE");
} catch (err) {
  fail("TEST 4 threw", err);
}

// ── TEST 5: Deploy 3 dashboards ───────────────────────────────────────────────

sep(`TEST 5 — Deploy dashboards to ${DASHY_SDK_KEY ? "dashy" : "MemoryDashboardStore"}`);
t = hrt();
const deployResults = await Promise.allSettled([
  revenueDash ? deployDash(revenueDash, "Revenue (charts)") : Promise.resolve(),
  custDash    ? deployDash(custDash,    "Customers (mui)")  : Promise.resolve(),
  prodDash    ? deployDash(prodDash,    "Products (html)")  : Promise.resolve(),
]);
deployResults.forEach((r, i) => {
  if (r.status === "rejected") fail(`Deploy ${i + 1} failed`, r.reason);
});
console.log(`  Deployed in ${ms(t)}`);

const listed = await sdk.list();
console.log(`  sdk.list() → ${listed.length} dashboard(s)`);
if (listed.length >= 1) pass(`Store has ${listed.length} dashboards`);
else fail("No dashboards in store");

// ── TEST 6: Infographic — generate (pipeline, not stream) ─────────────────────

sep("TEST 6 — Order volume infographic, generate (pipeline)");
t = hrt();
let infoDash: Dashboard | undefined;
try {
  infoDash = await sdk.generate(source, {
    prompt: "Tell the story of our order volume over the past 6 months. Are we growing? Where are the dips? What's the cancellation rate doing? Make it feel like a magazine feature, not a spreadsheet.",
    mode: "infographic",
    entities: ["orders"],
    dataLimit: providerArg === "openai" ? 30 : 100,
  });
  console.log(`  Generated in ${ms(t)} — ${infoDash.html_content.length.toLocaleString()} chars`);
  console.log(`  Title: ${infoDash.title}`);
  save(`${providerArg}-orders-infographic`, infoDash.html_content);
  if (infoDash.html_content.length > 500) pass("infographic html_content non-trivial");
  else fail("infographic too short");
  await deployDash(infoDash, "Infographic");
} catch (err) {
  fail("TEST 6 threw", err);
}

// ── TEST 7: Diagram — generate (pipeline, not stream) ────────────────────────

sep("TEST 7 — Schema diagram, generate (pipeline)");
t = hrt();
let diagramDash: Dashboard | undefined;
try {
  diagramDash = await sdk.generate(source, {
    prompt: "Show me how this database is structured. What connects to what? I want to understand the relationships between customers, orders, and products at a glance.",
    mode: "diagram",
    dataLimit: providerArg === "openai" ? 20 : 50,
  });
  console.log(`  Generated in ${ms(t)} — ${diagramDash.html_content.length.toLocaleString()} chars`);
  console.log(`  Title: ${diagramDash.title}`);
  save(`${providerArg}-schema-diagram`, diagramDash.html_content);
  if (diagramDash.html_content.toLowerCase().includes("<!doctype")) pass("diagram includes <!DOCTYPE");
  else fail("diagram missing <!DOCTYPE");
  if (diagramDash.html_content.includes("d3") || diagramDash.html_content.includes("<svg")) pass("diagram uses D3/SVG");
  else fail("diagram missing D3/SVG");
  if (diagramDash.mode === "diagram") pass("mode = diagram");
  else fail(`Expected mode=diagram, got ${diagramDash.mode}`);
  await deployDash(diagramDash, "Diagram");
} catch (err) {
  fail("TEST 7 threw", err);
}

// ── Summary ───────────────────────────────────────────────────────────────────

sep("SUMMARY");
const all = [revenueDash, custDash, prodDash, infoDash, diagramDash];
const deployed = all.filter(Boolean);
console.log(`  Generated : ${deployed.length}/5 dashboards`);
if (DASHY_SDK_KEY) {
  console.log(`  Dashy     : ${DASHY_BASE_URL}`);
  for (const d of deployed) {
    if (d?.id) console.log(`    ${d.mode.padEnd(12)} ${DASHY_BASE_URL}/dashboard/${d.id}`);
  }
}
if (process.exitCode) {
  console.log("\n  Some tests FAILED — see ❌ above");
} else {
  console.log("\n  All assertions passed.");
}
