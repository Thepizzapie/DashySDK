// Requires: npm install better-sqlite3 @types/better-sqlite3
import Database from "better-sqlite3";
import type { Dashboard, DashboardStore } from "../types.js";

export interface DashySqliteStoreConfig {
  /** Absolute or relative path to the dashy SQLite file, e.g. "../react-app-generator/server/dashy.sqlite3" */
  dbPath: string;
  /** The dashy user_id to associate dashboards with */
  userId: string;
}

interface DashboardRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  mode: string;
  prompt: string;
  html_content: string;
  is_public: number;
  public_slug: string | null;
  generation_meta: string | null;
  live_enabled: number;
  refresh_interval: number;
  last_refreshed_at: number | null;
  last_refreshed_data: string | null;
  source_bindings: string | null;
  public_slug_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export class DashySqliteStore implements DashboardStore {
  private db: Database.Database;
  private config: DashySqliteStoreConfig;

  constructor(config: DashySqliteStoreConfig) {
    this.config = config;
    this.db = new Database(config.dbPath);
  }

  private rowToDashboard(row: DashboardRow): Dashboard {
    let source_bindings: string[] = [];
    if (row.source_bindings) {
      try {
        const parsed = JSON.parse(row.source_bindings);
        source_bindings = Array.isArray(parsed) ? parsed : [];
      } catch {
        source_bindings = [];
      }
    }

    let generation_meta: Record<string, unknown> | undefined;
    if (row.generation_meta) {
      try {
        generation_meta = JSON.parse(row.generation_meta);
      } catch {
        generation_meta = undefined;
      }
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      mode: row.mode as Dashboard["mode"],
      prompt: row.prompt,
      html_content: row.html_content,
      generation_meta,
      is_public: row.is_public === 1,
      public_slug: row.public_slug ?? undefined,
      live_enabled: row.live_enabled === 1,
      refresh_interval: row.refresh_interval,
      source_bindings,
      created_at: new Date(row.created_at * 1000),
      updated_at: new Date(row.updated_at * 1000),
    };
  }

  async save(dashboard: Dashboard): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO dashboards (
        id, user_id, title, description, mode, prompt, html_content,
        is_public, public_slug, generation_meta,
        live_enabled, refresh_interval,
        last_refreshed_at, last_refreshed_data, source_bindings,
        public_slug_expires_at, created_at, updated_at
      ) VALUES (
        @id, @user_id, @title, @description, @mode, @prompt, @html_content,
        @is_public, @public_slug, @generation_meta,
        @live_enabled, @refresh_interval,
        @last_refreshed_at, @last_refreshed_data, @source_bindings,
        @public_slug_expires_at, @created_at, @updated_at
      )
    `);

    stmt.run({
      id: dashboard.id,
      user_id: this.config.userId,
      title: dashboard.title,
      description: dashboard.description ?? null,
      mode: dashboard.mode,
      prompt: dashboard.prompt,
      html_content: dashboard.html_content,
      is_public: dashboard.is_public ? 1 : 0,
      public_slug: dashboard.public_slug ?? null,
      generation_meta: dashboard.generation_meta != null
        ? JSON.stringify(dashboard.generation_meta)
        : null,
      live_enabled: dashboard.live_enabled ? 1 : 0,
      refresh_interval: dashboard.refresh_interval,
      last_refreshed_at: null,
      last_refreshed_data: null,
      source_bindings: JSON.stringify(dashboard.source_bindings),
      public_slug_expires_at: null,
      created_at: Math.floor(dashboard.created_at.getTime() / 1000),
      updated_at: Math.floor(dashboard.updated_at.getTime() / 1000),
    });
  }

  async get(id: string): Promise<Dashboard | null> {
    const stmt = this.db.prepare<[string], DashboardRow>(
      "SELECT * FROM dashboards WHERE id = ?"
    );
    const row = stmt.get(id);
    if (!row) return null;
    return this.rowToDashboard(row);
  }

  async list(): Promise<Dashboard[]> {
    const stmt = this.db.prepare<[string], DashboardRow>(
      "SELECT * FROM dashboards WHERE user_id = ? ORDER BY created_at DESC"
    );
    const rows = stmt.all(this.config.userId);
    return rows.map((row: DashboardRow) => this.rowToDashboard(row));
  }

  async delete(id: string): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM dashboards WHERE id = ?");
    stmt.run(id);
  }
}
