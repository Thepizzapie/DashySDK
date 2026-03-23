import { describe, it, expect } from "vitest";
import { ReportSDK, SDKValidationError } from "../../src/index.js";

describe("input validation", () => {
  const sdk = new ReportSDK({ provider: "anthropic", anthropicKey: "sk-ant-test" });

  it("throws SDKValidationError when prompt is missing", async () => {
    await expect(
      sdk.generate({ type: "inline", model: { entities: [], relationships: [], metrics: [], source: { type: "inline" } } }, { prompt: "" } as any)
    ).rejects.toThrow(SDKValidationError);
  });

  it("throws SDKValidationError when prompt exceeds 5000 chars", async () => {
    const longPrompt = "x".repeat(5001);
    await expect(
      sdk.generate({ type: "inline", model: { entities: [], relationships: [], metrics: [], source: { type: "inline" } } }, { prompt: longPrompt })
    ).rejects.toThrow(SDKValidationError);
  });

  it("throws SDKValidationError for invalid mode", async () => {
    await expect(
      sdk.generate(
        { type: "inline", model: { entities: [], relationships: [], metrics: [], source: { type: "inline" } } },
        { prompt: "test", mode: "invalid-mode" as any }
      )
    ).rejects.toThrow(SDKValidationError);
  });

  it("throws SDKValidationError for out-of-range dataLimit", async () => {
    await expect(
      sdk.generate(
        { type: "inline", model: { entities: [], relationships: [], metrics: [], source: { type: "inline" } } },
        { prompt: "test", dataLimit: 0 }
      )
    ).rejects.toThrow(SDKValidationError);
  });

  it("does not throw for valid options", async () => {
    // This will fail due to no real API key but should NOT throw SDKValidationError
    await expect(
      sdk.generate(
        { type: "inline", model: { entities: [], relationships: [], metrics: [], source: { type: "inline" } } },
        { prompt: "Show me a chart", mode: "charts", dataLimit: 100 }
      )
    ).rejects.not.toThrow(SDKValidationError);
  });
});
