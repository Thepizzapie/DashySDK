import type { Dashboard, DashboardStore } from "../types.js";

// ── In-memory store ────────────────────────────────────────────────────────────

export class MemoryDashboardStore implements DashboardStore {
  private store = new Map<string, Dashboard>();

  async save(dashboard: Dashboard): Promise<void> {
    this.store.set(dashboard.id, dashboard);
  }

  async get(id: string): Promise<Dashboard | null> {
    return this.store.get(id) ?? null;
  }

  async list(): Promise<Dashboard[]> {
    return [...this.store.values()].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime()
    );
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

/** @deprecated Use MemoryDashboardStore instead */
export const MemoryReportStore = MemoryDashboardStore;

export { DashyApiStore } from "./dashy-api-store.js";
export type { DashyApiStoreConfig } from "./dashy-api-store.js";

export { DashySqliteStore } from "./dashy-sqlite-store.js";
export type { DashySqliteStoreConfig } from "./dashy-sqlite-store.js";
