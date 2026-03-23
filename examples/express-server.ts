/**
 * Example: Express server that generates and serves dashboards on demand.
 *
 * Run: ANTHROPIC_API_KEY=... DATABASE_URL=... npx tsx examples/express-server.ts
 * Then visit: http://localhost:3000
 */
import express from "express";
import { createSDK, MemoryDashboardStore, reportMiddleware } from "../src/index.js";

const store = new MemoryDashboardStore();
const sdk = createSDK({
  anthropicKey: process.env.ANTHROPIC_API_KEY!,
  store,
});

const app = express();
app.use(express.json());

// Serve dashboard HTML at /reports/:id
app.use("/reports", reportMiddleware({ store }));

// API: generate a dashboard on demand
app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, mode } = req.body as { prompt: string; mode?: string };
    const dashboard = await sdk.generate(
      { type: "postgres", connectionString: process.env.DATABASE_URL! },
      { prompt, mode: (mode ?? "charts") as any }
    );
    await sdk.publish(dashboard);
    res.json({ id: dashboard.id, title: dashboard.title, mode: dashboard.mode });
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
        <textarea name="prompt" rows="3" style="width:100%" placeholder="Describe the dashboard you want..."></textarea><br><br>
        <select name="mode">
          <option value="charts">charts</option>
          <option value="mui">mui</option>
          <option value="html">html</option>
          <option value="infographic">infographic</option>
          <option value="diagram">diagram</option>
        </select>
        <button type="submit">Generate</button>
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
          if (data.error) { document.getElementById('result').innerHTML = 'Error: ' + data.error; return; }
          document.getElementById('result').innerHTML =
            '<p><a href="/reports/' + data.id + '" target="_blank">Open: ' + data.title + '</a></p>' +
            '<iframe src="/reports/' + data.id + '" width="100%" height="600" frameborder="0"></iframe>';
        }
      </script>
    </body></html>
  `);
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));
