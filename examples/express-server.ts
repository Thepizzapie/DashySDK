/**
 * Example: Express server with report serving middleware + React embed.
 *
 * Run: npx ts-node examples/express-server.ts
 * Then visit: http://localhost:3000
 */
import express from "express";
import { createSDK, ReportPublisher, reportMiddleware } from "../src/index.js";

const sdk = createSDK({
  anthropicKey: process.env.ANTHROPIC_API_KEY!,
  publish: {
    baseUrl: "http://localhost:3000",
    secret: process.env.REPORT_SECRET ?? "dev-secret",
    tokenTtl: 3600, // 1 hour tokens
  },
});

const app = express();
app.use(express.json());

// Serve published reports at /reports/:id?token=...
// Access the publisher via the SDK's internal publish config
const publisher = new ReportPublisher({
  baseUrl: "http://localhost:3000",
  secret: process.env.REPORT_SECRET ?? "dev-secret",
});
app.use("/reports", reportMiddleware({ publisher }));

// API: generate a report on demand
app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, mode, style } = req.body;
    const published = await sdk.generateAndPublish(
      {
        type: "postgres",
        connectionString: process.env.DATABASE_URL!,
      },
      { prompt, mode, style }
    );
    res.json(published);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Simple demo page
app.get("/", (_req, res) => {
  res.send(`
    <html><body style="font-family:sans-serif;padding:2rem">
      <h1>Dashy SDK Demo</h1>
      <form onsubmit="generate(event)">
        <textarea name="prompt" rows="3" style="width:100%" placeholder="Describe the report you want..."></textarea><br>
        <select name="mode"><option>charts</option><option>table</option><option>infographic</option><option>executive</option></select>
        <button type="submit">Generate Report</button>
      </form>
      <div id="result"></div>
      <script>
        async function generate(e) {
          e.preventDefault();
          const fd = new FormData(e.target);
          document.getElementById('result').innerHTML = 'Generating…';
          const res = await fetch('/api/generate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ prompt: fd.get('prompt'), mode: fd.get('mode') })
          });
          const data = await res.json();
          document.getElementById('result').innerHTML = \`
            <p><a href="\${data.url}" target="_blank">Open report</a></p>
            <iframe src="\${data.url}" width="100%" height="600" frameborder="0"></iframe>
          \`;
        }
      </script>
    </body></html>
  `);
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));
