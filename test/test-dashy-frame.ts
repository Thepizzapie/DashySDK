/**
 * DashyFrame integration test.
 *
 * 1. Generates a charts dashboard from stressdb
 * 2. Verifies useDashyData hook is present in the output
 * 3. Writes test/output/dashy-frame-test.html — a self-contained page that:
 *    - Renders the dashboard in an iframe (simulating DashyFrame)
 *    - Has an "Inject live data" button that postMessages real-looking data
 *    - Has a "Clear" button that resets to fallback data
 *    This lets you manually verify charts update without an iframe reload.
 *
 * Run: npx tsx test/test-dashy-frame.ts
 */

import { ReportSDK } from "../src/index.js";
import { DashyApiStore } from "../src/publish/dashy-api-store.js";
import { extractSentinelKeys } from "../src/hydrate.js";
import { prepareDoc } from "../src/frame/prepareDoc.js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "output");
mkdirSync(OUT, { recursive: true });

const CONNECTION = "postgresql://stress:stress@localhost:5434/stressdb";
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DASHY_SDK_KEY = process.env.DASHY_SDK_KEY;
const DASHY_BASE_URL = process.env.DASHY_BASE_URL ?? "http://localhost:3001";

if (!OPENAI_KEY) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

const store = DASHY_SDK_KEY
  ? new DashyApiStore({ baseUrl: DASHY_BASE_URL, token: DASHY_SDK_KEY })
  : undefined;

const sdk = new ReportSDK({ provider: "openai", openaiKey: OPENAI_KEY, store });
const source = { type: "postgres" as const, connectionString: CONNECTION, sampleSize: 10 };

// ── Step 1: Generate ──────────────────────────────────────────────────────────

console.log("Generating charts dashboard...");
process.stdout.write("Progress: ");
let result: any;
let deltas = 0;

for await (const chunk of sdk.stream(source, {
  prompt: "Monthly revenue, order count, average order value for the past year. Volume vs AOV breakdown.",
  mode: "charts",
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

// ── Step 2: Verify architecture ────────────────────────────────────────────────

const keys = extractSentinelKeys(result.html_content);
console.log(`Sentinels: ${keys.length > 0 ? keys.join(", ") + " ✅" : "NONE ❌"}`);

const hasHook = result.html_content.includes("useDashyData");
console.log(`useDashyData hook: ${hasHook ? "present ✅" : "MISSING ❌"}`);

const hasBootstrap = result.html_content.includes("__DASHY_SUBSCRIBE__");
console.log(`DASHY bootstrap: ${hasBootstrap ? "present ✅" : "MISSING ❌"}`);

if (!hasHook || !hasBootstrap) {
  console.error("\nArchitecture check failed — prompts.ts may not have been updated.");
  process.exit(1);
}

// ── Step 3: Build test harness page ───────────────────────────────────────────

// Generate mock "live" data matching the sentinel keys.
// Values are deliberately extreme so the visual difference is unmistakable.
const mockLiveData: Record<string, unknown[]> = {};
// Build mock data as raw order rows (matching the stressdb orders schema).
// Each month gets several rows so bucket-aggregation code has something to work with.
// The totals are deliberately huge so the visual spike is unmistakable.
for (const key of keys) {
  const rows: Record<string, unknown>[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    for (let j = 0; j < 5; j++) {
      const total = (m * 10_000 + j * 1_000).toFixed(2);
      rows.push({
        id: m * 100 + j,
        created_at: `2025-${mm}-${String(j + 1).padStart(2, "0")}T12:00:00Z`,
        total,
        subtotal: (Number(total) * 0.9).toFixed(2),
        discount: "0.00",
        tax: (Number(total) * 0.1).toFixed(2),
        status: j === 0 ? "cancelled" : "delivered",
        customer_id: 1000 + j,
      });
    }
  }
  mockLiveData[key] = rows;
}

// Write the dashboard HTML to a separate file — avoids </script> injection issues
const iframeSrc = prepareDoc(result.html_content);
writeFileSync(join(OUT, "dashy-frame-inner.html"), iframeSrc);

const liveDataJson = JSON.stringify(mockLiveData);

const testPage = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>DashyFrame Test Harness</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #080a10; color: #fff; font-family: monospace; display: flex; flex-direction: column; height: 100vh; }
    #toolbar {
      flex-shrink: 0;
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px;
      background: #0f1117;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    #toolbar h2 { font-size: 13px; color: #94a3b8; font-weight: 600; flex: 1; }
    button {
      padding: 6px 16px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12);
      font-size: 12px; font-weight: 700; cursor: pointer; font-family: monospace;
    }
    #btn-live { background: #2563eb; color: #fff; border-color: #2563eb; }
    #btn-live:hover { background: #1d4ed8; }
    #btn-clear { background: transparent; color: #94a3b8; }
    #btn-clear:hover { color: #fff; }
    #status { font-size: 11px; color: #64748b; }
    #status.live { color: #22c55e; }
    iframe { flex: 1; border: none; display: block; }
  </style>
</head>
<body>
  <div id="toolbar">
    <h2>DashyFrame Test — ${result.title}</h2>
    <span id="status">showing fallback data</span>
    <button id="btn-live" onclick="injectLive()">Inject Live Data</button>
    <button id="btn-clear" onclick="clearLive()">Reset to Fallback</button>
  </div>
  <iframe id="frame" src="/inner" sandbox="allow-scripts allow-same-origin"></iframe>

  <script>
    const iframeEl = document.getElementById('frame');
    const status = document.getElementById('status');
    const liveData = ${liveDataJson};

    function send(data) {
      iframeEl.contentWindow?.postMessage({ type: 'DASHY_UPDATE', data }, '*');
    }

    function injectLive() {
      send(liveData);
      status.textContent = 'showing LIVE data (postMessage injected)';
      status.className = 'live';
    }

    function clearLive() {
      iframeEl.src = './dashy-frame-inner.html';
      status.textContent = 'showing fallback data';
      status.className = '';
    }

    // Auto-inject after iframe loads
    iframeEl.addEventListener('load', () => setTimeout(injectLive, 1500));
  </script>
</body>
</html>`;

const testFile = join(OUT, "dashy-frame-test.html");
writeFileSync(testFile, testPage);
console.log(`\nTest harness → test/output/dashy-frame-test.html`);
console.log("Open it in a browser. It auto-injects live data after 1.5s.");
console.log(`\nSentinel keys found: ${keys.join(", ")}`);
console.log(`Mock live data has: ${Object.keys(mockLiveData).join(", ")}`);

if (store && DASHY_SDK_KEY) {
  try {
    console.log("\nDeploying to dashy...");
    await sdk.deploy(result, { refreshInterval: 300 });
    console.log(`Deployed: ${DASHY_BASE_URL}/dashboard/${result.id}`);
  } catch (e: any) {
    console.warn("Deploy skipped:", e.message);
  }
}

// ── Step 4: Serve over HTTP so postMessage works ──────────────────────────────

const PORT = 7477;
const server = createServer((req, res) => {
  const file = req.url === "/inner" ? "dashy-frame-inner.html" : "dashy-frame-test.html";
  try {
    const content = readFileSync(join(OUT, file));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`\n✅  Serving at http://localhost:${PORT}`);
  console.log(`   Open that URL in your browser.`);
  console.log(`   Charts load with fallback data, then live data injects after 1.5s.`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
