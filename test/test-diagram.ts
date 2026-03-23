/**
 * Diagram mode test against stressdb.
 * Run: npx tsx test/test-diagram.ts
 */
import { ReportSDK } from "../src/index.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { readFileSync } from "fs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "output");
mkdirSync(OUT, { recursive: true });

const CONNECTION = "postgresql://stress:stress@localhost:5434/stressdb";
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

const sdk = new ReportSDK({ provider: "openai", openaiKey: OPENAI_KEY });
const source = { type: "postgres" as const, connectionString: CONNECTION, sampleSize: 10 };

console.log("Generating diagram dashboard...");
process.stdout.write("Progress: ");
let result: any;
let deltas = 0;

for await (const chunk of sdk.stream(source, {
  prompt: "Order status distribution, revenue by month as a D3 bar chart, and a funnel from placed to delivered orders.",
  mode: "diagram",
  entities: ["orders"],
  dataLimit: 50,
})) {
  if (chunk.type === "delta") { deltas++; if (deltas % 20 === 0) process.stdout.write("."); }
  if (chunk.type === "done") result = chunk.dashboard;
}
process.stdout.write("\n\n");

if (!result) { console.error("No dashboard returned"); process.exit(1); }

console.log(`Title   : ${result.title}`);
console.log(`HTML    : ${result.html_content.length.toLocaleString()} chars`);
console.log(`Has D3  : ${result.html_content.includes("d3") ? "✅" : "❌"}`);
console.log(`Has SVG : ${result.html_content.includes("<svg") ? "✅" : "❌"}`);

writeFileSync(join(OUT, "diagram-test.html"), result.html_content);
console.log(`\nSaved → test/output/diagram-test.html`);

const PORT = 7479;
const server = createServer((req, res) => {
  try { res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"}); res.end(readFileSync(join(OUT,"diagram-test.html"))); }
  catch { res.writeHead(404); res.end("not found"); }
});
server.listen(PORT, () => {
  console.log(`\n✅  Diagram test at http://localhost:${PORT}`);
  console.log("   Press Ctrl+C to stop.\n");
});
