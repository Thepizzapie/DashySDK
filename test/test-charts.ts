/**
 * Quick single test — charts mode stream against stressdb.
 * Run: npx tsx test/test-charts.ts
 */

import { ReportSDK, MemoryDashboardStore } from "../src/index.js";
import { DashyApiStore } from "../src/publish/dashy-api-store.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "output");
mkdirSync(OUT, { recursive: true });

const CONNECTION = "postgresql://stress:stress@localhost:5434/stressdb";
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DASHY_SDK_KEY = process.env.DASHY_SDK_KEY;
const DASHY_BASE_URL = process.env.DASHY_BASE_URL ?? "http://localhost:3001";

if (!OPENAI_KEY) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

const store = DASHY_SDK_KEY
  ? new DashyApiStore({ baseUrl: DASHY_BASE_URL, token: DASHY_SDK_KEY })
  : new MemoryDashboardStore();

const sdk = new ReportSDK({ provider: "openai", openaiKey: OPENAI_KEY, store });
const source = { type: "postgres" as const, connectionString: CONNECTION, sampleSize: 10 };

console.log("Streaming charts dashboard...\n");
let deltas = 0;
let result: any;

process.stdout.write("Progress: ");
for await (const chunk of sdk.stream(source, {
  prompt: "Monthly revenue, order count, and average order size for the past year. Is it a volume or AOV problem?",
  mode: "charts",
  entities: ["orders"],
  dataLimit: 50,
})) {
  if (chunk.type === "delta") {
    deltas++;
    if (deltas % 20 === 0) process.stdout.write(".");
  }
  if (chunk.type === "done") result = chunk.dashboard;
}
process.stdout.write(`\n\n`);

if (!result) { console.error("No dashboard returned"); process.exit(1); }

console.log(`Title   : ${result.title}`);
console.log(`Mode    : ${result.mode}`);
console.log(`HTML len: ${result.html_content.length.toLocaleString()} chars`);
console.log(`Sentinels in HTML: ${(result.html_content.match(/DASHY_DATA:/g) ?? []).length > 0 ? "YES ✅" : "NO ❌"}`);

const outFile = join(OUT, "charts-test.html");
writeFileSync(outFile, result.html_content);
console.log(`\nSaved → test/output/charts-test.html`);

if (DASHY_SDK_KEY) {
  console.log("\nDeploying...");
  await sdk.deploy(result, { refreshInterval: 300 });
  console.log(`Deployed: ${DASHY_BASE_URL}/dashboard/${result.id}`);
} else {
  console.log("\n(No DASHY_SDK_KEY — skipping deploy)");
}
