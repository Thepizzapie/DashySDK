import OpenAI from "openai";
import type { SemanticModel, ReportOptions, Dashboard, SDKConfig, Row } from "../types.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { buildDashboard } from "./shared.js";
import { runPipeline } from "./pipeline.js";

export async function generateReportOpenAI(
  model: SemanticModel,
  options: ReportOptions,
  config: SDKConfig,
  queryData: Record<string, Row[]>
): Promise<Dashboard> {
  const systemPrompt = buildSystemPrompt(model, options, queryData);
  const { html } = await runPipeline(
    options.prompt,
    options.mode ?? "charts",
    systemPrompt,
    systemPrompt,
    config
  );
  return buildDashboard(html, options, model, queryData);
}

export async function* generateReportStreamOpenAI(
  model: SemanticModel,
  options: ReportOptions,
  config: SDKConfig,
  queryData: Record<string, Row[]>
): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; dashboard: Dashboard }> {
  const client = new OpenAI({ apiKey: config.openaiKey });
  const gptModel = config.model ?? "gpt-5.4-nano";

  const systemPrompt = buildSystemPrompt(model, options, queryData);
  const userPrompt = buildUserPrompt(options);

  let fullText = "";

  const stream = await client.chat.completions.create({
    model: gptModel,
    max_completion_tokens: 16000,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      fullText += delta;
      yield { type: "delta", text: delta };
    }
  }

  yield { type: "done", dashboard: buildDashboard(fullText, options, model, queryData) };
}
