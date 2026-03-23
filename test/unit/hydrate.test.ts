import { describe, it, expect } from "vitest";
import { extractSentinelKeys, hydrateHtml } from "../../src/hydrate.js";

describe("extractSentinelKeys", () => {
  it("detects a single sentinel key", () => {
    const html = `var data = /*DASHY_DATA:orders*/[{"id":1}]/*END_DASHY_DATA*/;`;
    expect(extractSentinelKeys(html)).toEqual(["orders"]);
  });

  it("detects multiple sentinel keys", () => {
    const html = `
      var a = /*DASHY_DATA:orders*/[]/*END_DASHY_DATA*/;
      var b = /*DASHY_DATA:users*/[]/*END_DASHY_DATA*/;
    `;
    const keys = extractSentinelKeys(html);
    expect(keys).toContain("orders");
    expect(keys).toContain("users");
    expect(keys).toHaveLength(2);
  });

  it("returns empty array when no sentinels present", () => {
    const html = `<div>No sentinels here</div>`;
    expect(extractSentinelKeys(html)).toEqual([]);
  });

  it("deduplicates repeated keys", () => {
    const html = `
      var a = /*DASHY_DATA:orders*/[]/*END_DASHY_DATA*/;
      var b = /*DASHY_DATA:orders*/[]/*END_DASHY_DATA*/;
    `;
    const keys = extractSentinelKeys(html);
    expect(keys).toEqual(["orders"]);
  });
});

describe("hydrateHtml", () => {
  it("replaces sentinel data with new rows and preserves sentinel markers", () => {
    const html = `var data = /*DASHY_DATA:orders*/[{"id":1}]/*END_DASHY_DATA*/;`;
    const newRows = [{ id: 10, name: "Alpha" }, { id: 11, name: "Beta" }];
    const result = hydrateHtml(html, { orders: newRows });
    expect(result).toContain("/*DASHY_DATA:orders*/");
    expect(result).toContain("/*END_DASHY_DATA*/");
    expect(result).toContain('"id":10');
    expect(result).toContain('"name":"Alpha"');
    // Old sample data should be gone
    expect(result).not.toContain('"id":1}]/*END');
  });

  it("leaves sentinel unchanged if key not in provided data", () => {
    const original = `var data = /*DASHY_DATA:orders*/[{"id":1}]/*END_DASHY_DATA*/;`;
    const result = hydrateHtml(original, { users: [{ id: 99 }] });
    // orders sentinel was not in fullData, so it stays untouched
    expect(result).toBe(original);
  });
});
