import Anthropic from "@anthropic-ai/sdk";
import type { SemanticModel, ReportOptions, Dashboard, SDKConfig, Row } from "../types.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { buildDashboard, extractHtml } from "./shared.js";
import { runPipeline } from "./pipeline.js";

export async function generateReportAnthropic(
  model: SemanticModel,
  options: ReportOptions,
  config: SDKConfig,
  queryData: Record<string, Row[]>
): Promise<Dashboard> {
  const systemPrompt = buildSystemPrompt(model, options, queryData);
  const dataContext = systemPrompt; // pipeline uses same context
  const { html } = await runPipeline(
    options.prompt,
    options.mode ?? "charts",
    systemPrompt,
    dataContext,
    config,
    undefined,
    config.logger
  );
  return buildDashboard(html, options, model, queryData);
}

export async function* generateReportStreamAnthropic(
  model: SemanticModel,
  options: ReportOptions,
  config: SDKConfig,
  queryData: Record<string, Row[]>
): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; dashboard: Dashboard }> {
  const client = new Anthropic({ apiKey: config.anthropicKey });
  const claudeModel = config.model ?? "claude-haiku-4-5-20251001";

  const systemPrompt = buildSystemPrompt(model, options, queryData);
  const userPrompt = buildUserPrompt(options);

  let fullText = "";

  const stream = client.messages.stream({
    model: claudeModel,
    max_tokens: 32000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      fullText += event.delta.text;
      yield { type: "delta", text: event.delta.text };
    }
  }

  yield { type: "done", dashboard: buildDashboard(fullText, options, model, queryData) };
}
