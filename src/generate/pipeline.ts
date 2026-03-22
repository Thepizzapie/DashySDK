/**
 * Multi-agent pipeline — mirrors dashy's runPipeline() exactly.
 *
 * Modes html/mui/charts:   planner + stylist (parallel) → visualizer → inspector + critic (parallel) → refiner (max 2x)
 * Modes infographic/diagram: editorial-planner → visualizer → inspector + critic (parallel) → refiner (max 1x)
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { SDKConfig } from "../types.js";

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  config: SDKConfig,
  maxTokens: number,
  modelOverride?: string
): Promise<string> {
  const provider = config.provider ?? "anthropic";

  if (provider === "openai") {
    const client = new OpenAI({ apiKey: config.openaiKey });
    const model = modelOverride ?? config.model ?? "gpt-5.4-nano";
    const res = await client.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return res.choices[0]?.message?.content ?? "";
  } else {
    const client = new Anthropic({ apiKey: config.anthropicKey });
    const model = modelOverride ?? config.model ?? "claude-haiku-4-5-20251001";
    const msg = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("");
  }
}

function cheapModel(config: SDKConfig): string {
  const provider = config.provider ?? "anthropic";
  return provider === "openai" ? "gpt-5.4-nano" : "claude-haiku-4-5-20251001";
}

function parseJSON(raw: string): Record<string, unknown> {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(stripped);
}

// ── Sub-agent prompts ─────────────────────────────────────────────────────────

function buildPlannerPrompt(): string {
  return `Output a JSON dashboard plan. ONLY the JSON object — no markdown, no prose.

{"title":string,"layout":"single-col"|"two-col"|"grid","components":[{"type":string,"purpose":string,"priority":number}],"dataSourcesUsed":[string],"highlights":[string]}

component types: kpi-card, bar-chart, line-chart, pie-chart, table, stat-card, progress-bar, radar-chart, treemap. 3–8 components. highlights = 3–5 key insights.`;
}

function buildStylistPrompt(): string {
  return `Output a JSON style guide for the dashboard plan. ONLY the JSON object — no markdown, no prose.

{"colorScheme":"dark"|"light","primaryAccent":hex,"cardStyle":"glass"|"flat"|"elevated"|"outlined","density":"compact"|"normal"|"spacious","chartPalette":[6 hex colors]}

chartPalette must have exactly 6 distinct harmonious hex colors.`;
}

function buildEditorialPlannerPrompt(mode: string, dataContext: string): string {
  const typeName = mode === "infographic" ? "infographic" : "diagram";
  const visualTypes = "annotated-chart, timeline, flow-diagram, comparison-table, network-graph, bar-chart, scatter-plot, treemap";
  return `Output a JSON plan for a ${typeName}. ONLY the JSON object — no markdown, no prose.

{"title":string,"subtitle":string,"narrative":string,"sections":[{"heading":string,"purpose":string,"visualType":string,"keyFacts":[string]}],"dataSourcesUsed":[string],"visualMetaphors":[string],"typography":"serif"|"sans","colorMood":string}

Rules: 2–5 sections. visualType from: ${visualTypes}. keyFacts = 2–4 facts verbatim from data (exact names/numbers). No dashboard cards or KPI tiles.

DATA CONTEXT:
${dataContext}`;
}

function buildCriticPrompt(mode: string): string {
  const isEditorial = mode === "infographic" || mode === "diagram";
  if (isEditorial) {
    const typeName = mode === "infographic" ? "infographic" : "diagram";
    return `You are a visual design critic reviewing a generated ${typeName}. Evaluate it against the original user request and output a JSON critique.

Output ONLY valid JSON — no markdown, no prose, no code fences.

Schema:
{
  "score": number (1-10),
  "issues": [string],
  "suggestions": [string],
  "missingKPIs": [],
  "dataAccuracy": "accurate" | "minor-issues" | "major-issues",
  "layoutAssessment": "good" | "cluttered" | "sparse"
}

Check for:
1. Does the ${typeName} directly address the user's topic/request?
2. Are all data values concrete and specific — no "N/A", "TBD", "XX%", or placeholder text?
3. Are computed values (totals, percentages, averages) arithmetically correct?
4. Is the visual hierarchy clear — main story obvious at a glance?
5. Does it use the correct output format?${mode === "infographic"
  ? "\n   VALID: Full editorial HTML with prose sections and inline SVG charts.\n   INVALID: MUI card grids, stat card dashboards, number-only layouts."
  : "\n   VALID: SVG/D3 charts inside <div> containers, multi-panel figures with D3 force/bar/scatter/network, hand-crafted SVG flowcharts.\n   INVALID: Pure HTML stat cards with just text/numbers, MUI-style card grids with no SVG content."}
6. Are there any visual encoding issues (wrong chart type, missing labels, unreadable contrast)?

Penalty rules (lower score significantly for these):
- HTML stat cards with ONLY text/numbers and NO SVG or D3 chart: -4 points
- MUI/React component syntax (sx={{}}, <Box>, <Card>) in output: -3 points
- Placeholder/fake data values: -2 points per instance
- Missing key visual elements the prompt asked for: -2 points each

Scoring: 9-10 = excellent, 7-8 = good, 5-6 = needs improvement, 1-4 = poor.
Output ONLY the JSON object.`;
  }

  return `Score this dashboard HTML. ONLY the JSON object — no markdown, no prose.

{"score":number(1-10),"issues":[string],"suggestions":[string],"missingKPIs":[string],"dataAccuracy":"accurate"|"minor-issues"|"major-issues","layoutAssessment":"good"|"cluttered"|"sparse"}

Check: prompt fully addressed; no placeholder text (XXX/TBD/N/A); computed values correct; KPIs present if implied; layout balanced.
Deduct: -2 wrong totals/percentages, -2 fabricated values, -1 placeholder cells.
Scoring: 9-10=excellent, 7-8=good, 5-6=needs work, 1-4=poor.`;
}

function buildLayoutInspectorPrompt(mode: string): string {
  const isEditorial = mode === "infographic" || mode === "diagram";
  return `Scan this HTML for layout bugs. Output ONLY a JSON object — no markdown, no prose.

{"severity":"none"|"minor"|"major","clippingIssues":[string],"overflowIssues":[string],"sizingIssues":[string],"fixes":[string]}

Check for: SVG missing overflow="visible" with near-edge labels; text nodes outside viewBox bounds; overflow:hidden on chart containers; SVG width/height of 0; legends overlapping chart area; ${
  isEditorial
    ? "SVG viewBox too tight for content."
    : "Recharts ResponsiveContainer with height=100% in unbound flex parent."
}

Each fix must be specific (e.g. "Add overflow='visible' to SVG on line ~N"). If no issues, severity="none" and empty arrays.`;
}

// ── Pipeline result ───────────────────────────────────────────────────────────

export interface PipelineResult {
  html: string;
  planSpec: Record<string, unknown>;
  styleGuide: Record<string, unknown> | null;
  criticFeedback: { score: number; issues: string[]; suggestions: string[] };
  layoutReport: { severity: string; fixes: string[] };
  refinements: number;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runPipeline(
  userPrompt: string,
  mode: string,
  systemPrompt: string,
  dataContext: string,
  config: SDKConfig,
  onStep?: (step: string) => void
): Promise<PipelineResult> {
  const isEditorial = mode === "infographic" || mode === "diagram";
  const MAX_REFINE_LOOPS = isEditorial ? 1 : 2;
  const haiku = cheapModel(config);
  const emit = (step: string) => onStep?.(step);

  // ── Step 1: Planner (+ Stylist for dashboard modes) ──────────────────────────

  let planSpec: Record<string, unknown>;
  let styleGuide: Record<string, unknown> | null = null;

  if (isEditorial) {
    emit("planning");
    const planRaw = await callLLM(
      buildEditorialPlannerPrompt(mode, dataContext),
      `User request: ${userPrompt}`,
      { ...config, model: haiku },
      2000
    );
    try {
      planSpec = parseJSON(planRaw);
    } catch {
      planSpec = { title: userPrompt, sections: [], dataSourcesUsed: [], visualMetaphors: [] };
    }
  } else {
    emit("planning");
    const [planRaw, styleRaw] = await Promise.all([
      callLLM(
        buildPlannerPrompt(),
        `User request: ${userPrompt}\n\nDATA CONTEXT:\n${dataContext}`,
        { ...config, model: haiku },
        2000
      ),
      callLLM(
        buildStylistPrompt(),
        `User request: ${userPrompt}`,
        { ...config, model: haiku },
        1000
      ),
    ]);
    try { planSpec = parseJSON(planRaw); }
    catch { planSpec = { title: "Dashboard", components: [], layout: "grid", dataSourcesUsed: [], highlights: [] }; }
    try { styleGuide = parseJSON(styleRaw); }
    catch {
      styleGuide = {
        colorScheme: "dark", primaryAccent: "#2563eb", cardStyle: "flat",
        density: "normal", chartPalette: ["#2563eb", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#38bdf8"],
      };
    }
  }

  // ── Step 2: Visualizer ────────────────────────────────────────────────────────

  let visualizerPrompt: string;

  if (isEditorial) {
    const s = planSpec as {
      title?: string; subtitle?: string; narrative?: string;
      sections?: Array<{ heading: string; purpose: string; visualType: string; keyFacts?: string[] }>;
      dataSourcesUsed?: string[]; visualMetaphors?: string[]; typography?: string; colorMood?: string;
    };
    visualizerPrompt = `[EDITORIAL BRIEF — follow this narrative direction closely]
Title: ${s.title ?? ""}${s.subtitle ? `\nSubtitle: ${s.subtitle}` : ""}
Narrative: ${s.narrative ?? ""}
Sections: ${(s.sections ?? []).map(sec => `${sec.heading} (${sec.purpose}, visual: ${sec.visualType}, facts: ${(sec.keyFacts ?? []).join("; ")})`).join(" | ")}
Data sources to draw from: ${(s.dataSourcesUsed ?? []).join(", ")}
Visual metaphors: ${(s.visualMetaphors ?? []).join(", ")}
Typography: ${s.typography ?? "serif"}, mood: ${s.colorMood ?? "editorial"}
[END EDITORIAL BRIEF]

IMPORTANT: Output a ${mode === "infographic" ? "full editorial infographic — NOT a dashboard" : "technical diagram/academic figure — NOT a dashboard"}. No MUI components. No card grids. Follow the section structure above.

USER REQUEST:\n${userPrompt}`;
  } else {
    const p = planSpec as {
      title?: string; layout?: string;
      components?: Array<{ type: string; purpose: string }>;
      dataSourcesUsed?: string[]; highlights?: string[];
    };
    const sg = styleGuide as {
      colorScheme?: string; primaryAccent?: string; cardStyle?: string;
      density?: string; chartPalette?: string[];
    };
    visualizerPrompt = `[PIPELINE CONTEXT — follow this specification closely]
Title: ${p.title ?? ""}
Layout: ${p.layout ?? "grid"}
Components: ${(p.components ?? []).map(c => `${c.type} (${c.purpose})`).join(", ")}
Data sources: ${(p.dataSourcesUsed ?? []).join(", ")}
Key insights: ${(p.highlights ?? []).join("; ")}
Style: ${sg?.colorScheme ?? "dark"} scheme, accent ${sg?.primaryAccent ?? "#2563eb"}, ${sg?.cardStyle ?? "flat"} cards, ${sg?.density ?? "normal"} density
Chart palette: ${(sg?.chartPalette ?? []).join(", ")}
[END PIPELINE CONTEXT]

USER REQUEST:\n${userPrompt}`;
  }

  emit("generating");
  const vizMaxTokens = isEditorial ? 10000 : 16000;
  let html = await callLLM(systemPrompt, visualizerPrompt, config, vizMaxTokens);

  // ── Step 3: Inspector + Critic in parallel ────────────────────────────────────

  emit("inspecting");
  const [layoutRaw, criticRaw] = await Promise.all([
    callLLM(
      buildLayoutInspectorPrompt(mode),
      `HTML TO INSPECT:\n${html}`,
      { ...config, model: haiku },
      1500
    ),
    callLLM(
      buildCriticPrompt(mode),
      `ORIGINAL USER REQUEST:\n${userPrompt}\n\nGENERATED HTML:\n${html}`,
      { ...config, model: haiku },
      2000
    ),
  ]);

  let layoutReport: { severity: string; clippingIssues?: string[]; overflowIssues?: string[]; sizingIssues?: string[]; fixes: string[] };
  try { layoutReport = parseJSON(layoutRaw) as typeof layoutReport; }
  catch { layoutReport = { severity: "none", clippingIssues: [], overflowIssues: [], sizingIssues: [], fixes: [] }; }

  let criticFeedback: { score: number; issues: string[]; suggestions: string[] };
  try { criticFeedback = parseJSON(criticRaw) as typeof criticFeedback; }
  catch { criticFeedback = { score: 7, issues: [], suggestions: [] }; }

  // Merge layout issues into critic
  if (layoutReport.severity !== "none") {
    criticFeedback.issues = [
      ...(criticFeedback.issues ?? []),
      ...(layoutReport.clippingIssues ?? []).map(i => `[Layout] ${i}`),
      ...(layoutReport.overflowIssues ?? []).map(i => `[Layout] ${i}`),
      ...(layoutReport.sizingIssues ?? []).map(i => `[Layout] ${i}`),
    ];
    criticFeedback.suggestions = [
      ...(criticFeedback.suggestions ?? []),
      ...(layoutReport.fixes ?? []).map(f => `[Layout fix] ${f}`),
    ];
  }

  // ── Step 4: Refiner loop ──────────────────────────────────────────────────────

  const outputTypeName = isEditorial ? (mode === "infographic" ? "infographic" : "diagram") : "dashboard";
  let refinements = 0;

  while (refinements < MAX_REFINE_LOOPS && criticFeedback.score < 6) {
    emit("refining");
    const refinePrompt = `You previously generated this ${outputTypeName}. Fix these issues:

CRITIC SCORE: ${criticFeedback.score}/10
ISSUES:
${(criticFeedback.issues ?? []).map((v, i) => `${i + 1}. ${v}`).join("\n")}
SUGGESTIONS:
${(criticFeedback.suggestions ?? []).map((v, i) => `${i + 1}. ${v}`).join("\n")}

Apply all fixes. Return complete improved HTML. No other changes.

CURRENT HTML:
${html}`;

    html = await callLLM(systemPrompt, refinePrompt, config, 16000);
    refinements++;

    if (refinements < MAX_REFINE_LOOPS) {
      try {
        const recriticRaw = await callLLM(
          buildCriticPrompt(mode),
          `ORIGINAL USER REQUEST:\n${userPrompt}\n\nGENERATED HTML:\n${html}`,
          { ...config, model: haiku },
          2000
        );
        criticFeedback = parseJSON(recriticRaw) as typeof criticFeedback;
        if (criticFeedback.score >= 8) break;
      } catch {
        break;
      }
    }
  }

  return { html, planSpec, styleGuide, criticFeedback, layoutReport, refinements };
}
