/**
 * Tests for MemoryDashboardStore (src/publish/index.ts)
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Dashboard } from "../../src/types.js";
import { MemoryDashboardStore } from "../../src/publish/index.js";

// ── helper ────────────────────────────────────────────────────────────────────

function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  const now = new Date();
  return {
    id: "dash_store000001",
    title: "Store Test Dashboard",
    prompt: "Show me store data",
    mode: "charts",
    html_content: "<html><body><p>Store</p></body></html>",
    is_public: false,
    live_enabled: false,
    refresh_interval: 300,
    source_bindings: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("MemoryDashboardStore", () => {
  let store: MemoryDashboardStore;

  beforeEach(() => {
    store = new MemoryDashboardStore();
  });

  it("save and get — save a dashboard, get it back by id", async () => {
    const dash = makeDashboard({ id: "dash_saveget00001", title: "SaveGet" });
    await store.save(dash);

    const retrieved = await store.get("dash_saveget00001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("dash_saveget00001");
    expect(retrieved!.title).toBe("SaveGet");
    expect(retrieved!.prompt).toBe("Show me store data");
    expect(retrieved!.html_content).toBe("<html><body><p>Store</p></body></html>");
  });

  it("list — save 3 dashboards, list returns all 3", async () => {
    await store.save(makeDashboard({ id: "dash_list0000001", title: "One" }));
    await store.save(makeDashboard({ id: "dash_list0000002", title: "Two" }));
    await store.save(makeDashboard({ id: "dash_list0000003", title: "Three" }));

    const all = await store.list();
    expect(all).toHaveLength(3);

    const ids = all.map(d => d.id);
    expect(ids).toContain("dash_list0000001");
    expect(ids).toContain("dash_list0000002");
    expect(ids).toContain("dash_list0000003");
  });

  it("get missing — get with unknown id returns null", async () => {
    const result = await store.get("dash_doesnotexist");
    expect(result).toBeNull();
  });

  it("update — save dashboard, overwrite with same id, get returns updated version", async () => {
    const original = makeDashboard({
      id: "dash_update000001",
      title: "Original Title",
      html_content: "<html><body>Original</body></html>",
    });
    await store.save(original);

    const updated: Dashboard = {
      ...original,
      title: "Updated Title",
      html_content: "<html><body>Updated</body></html>",
      updated_at: new Date(),
    };
    await store.save(updated);

    const retrieved = await store.get("dash_update000001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe("Updated Title");
    expect(retrieved!.html_content).toBe("<html><body>Updated</body></html>");
  });

  it("delete — save dashboard, delete it, get returns null", async () => {
    const dash = makeDashboard({ id: "dash_delete000001" });
    await store.save(dash);

    // confirm it exists first
    expect(await store.get("dash_delete000001")).not.toBeNull();

    await store.delete("dash_delete000001");

    expect(await store.get("dash_delete000001")).toBeNull();
  });
});
