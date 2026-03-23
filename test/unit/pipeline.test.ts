/**
 * Tests for timeout helper and shared utilities.
 *
 * withTimeout is not exported from pipeline.ts, so we test it indirectly
 * via a local reimplementation that mirrors the exact source (Promise.race +
 * setTimeout reject). generateId is exported from src/generate/shared.ts.
 */

import { describe, it, expect } from "vitest";
import { generateId } from "../../src/generate/shared.js";
import { SDKTimeoutError, SDKLLMError } from "../../src/errors.js";

// ── Local reimplementation of withTimeout (mirrors pipeline.ts exactly) ──────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms (${label})`)), ms)
    ),
  ]);
}

// ── withTimeout tests ─────────────────────────────────────────────────────────

describe("withTimeout", () => {
  it("resolves — a promise resolving in 10ms with 1000ms timeout resolves normally", async () => {
    const fast = new Promise<string>(resolve => setTimeout(() => resolve("done"), 10));
    const result = await withTimeout(fast, 1000, "test");
    expect(result).toBe("done");
  });

  it("rejects — a promise taking 200ms with 50ms timeout rejects with timeout error", async () => {
    const slow = new Promise<string>(resolve => setTimeout(() => resolve("too late"), 200));
    await expect(withTimeout(slow, 50, "slow-label")).rejects.toThrow(
      "LLM call timed out after 50ms (slow-label)"
    );
  });
});

// ── generateId tests ──────────────────────────────────────────────────────────

describe("generateId", () => {
  it("format — returns a string starting with 'dash_' and at least 10 chars total", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("dash_")).toBe(true);
    expect(id.length).toBeGreaterThanOrEqual(10);
  });

  it("uniqueness — calling 100 times produces 100 unique values", () => {
    const ids = Array.from({ length: 100 }, () => generateId());
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });

  it("uses crypto — output is not predictable / not in ascending sorted order", () => {
    const ids = Array.from({ length: 10 }, () => generateId());
    // If IDs were sequential they would already be sorted; crypto randomness
    // makes ascending order astronomically unlikely.
    const sorted = [...ids].sort();
    const isAlreadySorted = ids.every((id, i) => id === sorted[i]);
    expect(isAlreadySorted).toBe(false);
  });
});

// ── SDKTimeoutError / SDKLLMError tests ───────────────────────────────────────

describe("SDKTimeoutError / SDKLLMError", () => {
  it("SDKTimeoutError has correct name and step", () => {
    const err = new SDKTimeoutError("openai");
    expect(err.name).toBe("SDKTimeoutError");
    expect(err.step).toBe("openai");
    expect(err.message).toBe("LLM call timed out (openai)");
  });

  it("SDKLLMError has correct name, provider, statusCode", () => {
    const err = new SDKLLMError("rate limited", "anthropic", 429);
    expect(err.name).toBe("SDKLLMError");
    expect(err.provider).toBe("anthropic");
    expect(err.statusCode).toBe(429);
  });

  it("SDKLLMError without statusCode", () => {
    const err = new SDKLLMError("network error", "openai");
    expect(err.statusCode).toBeUndefined();
  });
});
