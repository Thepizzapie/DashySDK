import type { SemanticModel, ReportOptions, Dashboard, SDKConfig, Row } from "../types.js";
import { generateReportAnthropic, generateReportStreamAnthropic } from "./claude.js";
import { generateReportOpenAI, generateReportStreamOpenAI } from "./openai.js";

export async function generateReport(
  model: SemanticModel,
  options: ReportOptions,
  config: SDKConfig,
  queryData: Record<string, Row[]> = {}
): Promise<Dashboard> {
  const provider = config.provider ?? "anthropic";
  if (provider === "openai") return generateReportOpenAI(model, options, config, queryData);
  return generateReportAnthropic(model, options, config, queryData);
}

export async function* generateReportStream(
  model: SemanticModel,
  options: ReportOptions,
  config: SDKConfig,
  queryData: Record<string, Row[]> = {}
): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; dashboard: Dashboard }> {
  const provider = config.provider ?? "anthropic";
  if (provider === "openai") {
    yield* generateReportStreamOpenAI(model, options, config, queryData);
  } else {
    yield* generateReportStreamAnthropic(model, options, config, queryData);
  }
}
