import type { Dashboard, ReportOptions, Row, SemanticModel } from "../types.js";

// Shell used to wrap html-mode output. The LLM emits <div class="rendered">...</div>
// (not a full document), so we inject dashy's glassmorphic CSS and give the browser a
// proper DOCTYPE to render against.
const HTML_MODE_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
/* dashy rendered CSS */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0f1117; color: #e2e8f0; font-family: system-ui, sans-serif; padding: 24px; }
/* glassmorphic classes */
.glass-mesh-gradient { background: radial-gradient(circle at 0% 0%, rgba(37,99,235,0.3), transparent 50%), radial-gradient(circle at 100% 100%, rgba(124,58,237,0.3), transparent 50%); }
.shimmer-glass-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; backdrop-filter: blur(20px); }
.neon-metric { background: rgba(37,99,235,0.05); border: 1px solid rgba(37,99,235,0.2); border-radius: 12px; padding: 20px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 16px; }
.glass-bento { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
.neon-table table { width: 100%; border-collapse: collapse; }
.neon-table th, .neon-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.06); }
.neon-table tr:hover { background: rgba(37,99,235,0.08); }
.badge { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.badge-green { background: rgba(16,185,129,0.15); color: #10b981; }
.badge-red { background: rgba(239,68,68,0.15); color: #ef4444; }
.badge-amber { background: rgba(245,158,11,0.15); color: #f59e0b; }
.badge-blue { background: rgba(37,99,235,0.15); color: #60a5fa; }
.progress-bar { background: rgba(255,255,255,0.08); border-radius: 999px; height: 8px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; background: #2563eb; }
.tabs-bar { display: flex; gap: 8px; margin-bottom: 16px; }
.tab-btn { padding: 8px 16px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; border-radius: 8px; cursor: pointer; font-size: 14px; }
.tab-btn.active { background: #2563eb; color: #fff; border-color: #2563eb; }
.tab-panel { display: none; } .tab-panel.active { display: block; }
.list-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
.muted { color: #94a3b8; font-size: 13px; }
.alert { padding: 12px 16px; border-radius: 8px; margin: 8px 0; }
.alert-info { background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.2); color: #38bdf8; }
.alert-success { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); color: #10b981; }
.alert-warning { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); color: #f59e0b; }
.alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #ef4444; }
h2 { font-size: 20px; font-weight: 700; margin-bottom: 12px; }
h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
</style>
</head>
<body>
RENDERED_CONTENT_HERE
</body>
</html>`;

export function extractHtml(text: string): string {
  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // html mode: LLM emits <div class="rendered">...</div> — wrap in full document shell
  if (text.includes('<div class="rendered"')) {
    return HTML_MODE_SHELL.replace("RENDERED_CONTENT_HERE", text.trim());
  }

  const doctypeMatch = text.match(/(<!DOCTYPE[\s\S]*)/i);
  if (doctypeMatch) return doctypeMatch[1].trim();

  return text.trim();
}

export function buildDashboard(
  rawText: string,
  options: ReportOptions,
  model: SemanticModel,
  queryData: Record<string, Row[]> = {}
): Dashboard {
  const html_content = extractHtml(rawText);
  const titleMatch = html_content.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : options.prompt.slice(0, 80);
  const now = new Date();

  // Detect which entities were actually used (had data passed with at least one row)
  const boundEntities = Object.keys(queryData).filter(k => queryData[k].length > 0);

  return {
    id: generateId(),
    title,
    prompt: options.prompt,
    mode: options.mode ?? "charts",
    html_content,
    generation_meta: {
      model: model.source.type,
      entityCount: model.entities.length,
      queriedEntities: boundEntities,
    },
    is_public: false,
    live_enabled: false,
    refresh_interval: 300,
    source_bindings: boundEntities,
    created_at: now,
    updated_at: now,
  };
}

export function generateId(): string {
  return `dash_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
