import { describe, it, expect } from "vitest";
import { SDKValidationError, SDKTimeoutError, SDKLLMError, SDKConnectorError } from "../../src/errors.js";

describe("SDKValidationError", () => {
  it("has correct name and field", () => {
    const err = new SDKValidationError("bad prompt", "prompt");
    expect(err.name).toBe("SDKValidationError");
    expect(err.field).toBe("prompt");
    expect(err.message).toBe("bad prompt");
    expect(err instanceof Error).toBe(true);
  });

  it("field is optional", () => {
    const err = new SDKValidationError("bad input");
    expect(err.field).toBeUndefined();
  });
});

describe("SDKTimeoutError", () => {
  it("has correct name and step", () => {
    const err = new SDKTimeoutError("visualizer");
    expect(err.name).toBe("SDKTimeoutError");
    expect(err.step).toBe("visualizer");
    expect(err.message).toContain("visualizer");
  });
});

describe("SDKLLMError", () => {
  it("has provider and statusCode", () => {
    const err = new SDKLLMError("rate limited", "openai", 429);
    expect(err.name).toBe("SDKLLMError");
    expect(err.provider).toBe("openai");
    expect(err.statusCode).toBe(429);
  });
});

describe("SDKConnectorError", () => {
  it("has sourceType", () => {
    const err = new SDKConnectorError("connection refused", "postgres");
    expect(err.name).toBe("SDKConnectorError");
    expect(err.sourceType).toBe("postgres");
  });
});
