/**
 * MUI mode test against stressdb.
 * Run: npx tsx test/test-mui.ts
 */
import { ReportSDK } from "../src/index.js";
import { prepareDoc } from "../src/frame/prepareDoc.js";
import { extractSentinelKeys } from "../src/hydrate.js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "output");
mkdirSync(OUT, { recursive: true });

const CONNECTION = "postgresql://stress:stress@localhost:5434/stressdb";
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

const sdk = new ReportSDK({ provider: "openai", openaiKey: OPENAI_KEY });
const source = { type: "postgres" as const, connectionString: CONNECTION, sampleSize: 10 };

console.log("Generating MUI dashboard...");
process.stdout.write("Progress: ");
let result: any;
let deltas = 0;

for await (const chunk of sdk.stream(source, {
  prompt: "Revenue overview dashboard: total revenue, order count, average order value as KPIs, plus a table of the top customers by spend.",
  mode: "mui",
  entities: ["orders", "customers"],
  dataLimit: 50,
})) {
  if (chunk.type === "delta") { deltas++; if (deltas % 20 === 0) process.stdout.write("."); }
  if (chunk.type === "done") result = chunk.dashboard;
}
process.stdout.write("\n\n");

if (!result) { console.error("No dashboard returned"); process.exit(1); }

console.log(`Title   : ${result.title}`);
console.log(`HTML    : ${result.html_content.length.toLocaleString()} chars`);

const keys = extractSentinelKeys(result.html_content);
console.log(`Sentinels: ${keys.length > 0 ? keys.join(", ") + " ✅" : "NONE ❌"}`);

const hasHook = result.html_content.includes("useDashyData");
console.log(`useDashyData: ${hasHook ? "✅" : "❌"}`);

const innerHtml = prepareDoc(result.html_content);
writeFileSync(join(OUT, "mui-inner.html"), innerHtml);

// Build simple harness
const mockData: Record<string, unknown[]> = {};
for (const key of keys) {
  mockData[key] = Array.from({ length: 20 }, (_, i) => {
    const m = (i % 12) + 1;
    const total = ((i + 1) * 5000).toFixed(2);
    return {
      id: 10000 + i, customer_id: 200 + i,
      created_at: `2025-${String(m).padStart(2,"0")}-${String((i%28)+1).padStart(2,"0")}T10:00:00Z`,
      total, subtotal: (Number(total)*0.9).toFixed(2),
      discount: "0.00", tax: (Number(total)*0.1).toFixed(2),
      status: i % 5 === 0 ? "cancelled" : "delivered",
    };
  });
}

const PORT = 7478;
const harness = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>MUI Test</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#080a10;color:#fff;font-family:monospace;display:flex;flex-direction:column;height:100vh}
#tb{flex-shrink:0;display:flex;align-items:center;gap:12px;padding:10px 16px;background:#0f1117;border-bottom:1px solid rgba(255,255,255,0.08)}
#tb h2{font-size:13px;color:#94a3b8;flex:1}button{padding:6px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);font-size:12px;font-weight:700;cursor:pointer}
#bl{background:#2563eb;color:#fff;border-color:#2563eb}#st{font-size:11px;color:#64748b}#st.live{color:#22c55e}
iframe{flex:1;border:none;display:block}</style></head><body>
<div id="tb"><h2>MUI Test — ${result.title}</h2><span id="st">fallback data</span>
<button id="bl" onclick="inject()">Inject Live Data</button></div>
<iframe id="f" src="/inner" sandbox="allow-scripts allow-same-origin"></iframe>
<script>
const f=document.getElementById('f'),st=document.getElementById('st');
const data=${JSON.stringify(mockData)};
function inject(){f.contentWindow?.postMessage({type:'DASHY_UPDATE',data},'*');st.textContent='LIVE data injected';st.className='live';}
f.addEventListener('load',()=>setTimeout(inject,1500));
</script></body></html>`;

writeFileSync(join(OUT, "mui-harness.html"), harness);

const server = createServer((req, res) => {
  const file = req.url === "/inner" ? "mui-inner.html" : "mui-harness.html";
  try { res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"}); res.end(readFileSync(join(OUT,file))); }
  catch { res.writeHead(404); res.end("not found"); }
});
server.listen(PORT, () => {
  console.log(`\n✅  MUI test at http://localhost:${PORT}`);
  console.log("   Press Ctrl+C to stop.\n");
});
