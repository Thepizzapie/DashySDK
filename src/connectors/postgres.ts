import { Client } from "pg";
import type {
  Connector, PostgresSourceConfig, SemanticModel,
  Entity, Column, Relationship, Metric, Row, ScalarType,
} from "../types.js";
import { humanize } from "./utils.js";

// ── Type mapping ───────────────────────────────────────────────────────────────

function pgTypeToScalar(pgType: string): ScalarType {
  if (/^(int|bigint|smallint|serial|numeric|decimal|float|double|real|money)/.test(pgType)) return "number";
  if (/^(bool)/.test(pgType)) return "boolean";
  if (/^(timestamp|timestamptz)/.test(pgType)) return "datetime";
  if (/^(date)/.test(pgType)) return "date";
  if (/^(json|jsonb)/.test(pgType)) return "json";
  if (/^(char|text|varchar|uuid|enum|citext)/.test(pgType)) return "string";
  return "unknown";
}

function inferRole(col: Column, pgType: string): Column["role"] {
  if (col.isPrimaryKey || col.isForeignKey) return "identifier";
  if (col.type === "datetime" || col.type === "date") return "timestamp";
  if (col.type === "number") return "metric";
  if (col.type === "string") return "dimension";
  return undefined;
}

// ── Postgres connector ─────────────────────────────────────────────────────────

export class PostgresConnector implements Connector {
  private client: Client;

  constructor(private config: PostgresSourceConfig) {
    this.client = new Client({ connectionString: config.connectionString });
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    await this.client.end();
  }

  async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    const result = await this.client.query(sql, params);
    return result.rows;
  }

  async introspect(): Promise<SemanticModel> {
    const [columns, pks, fks, counts] = await Promise.all([
      this.fetchColumns(),
      this.fetchPrimaryKeys(),
      this.fetchForeignKeys(),
      this.fetchRowCounts(),
    ]);

    const pkSet = new Set(pks.map(r => `${r.table_name}.${r.column_name}`));
    const fkMap = new Map(fks.map(r => [
      `${r.table_name}.${r.column_name}`,
      { entity: r.foreign_table_name as string, column: r.foreign_column_name as string },
    ]));

    // Group columns by table
    const tableMap = new Map<string, Column[]>();
    for (const col of columns) {
      const key = col.table_name as string;
      if (!tableMap.has(key)) tableMap.set(key, []);
      const isPK = pkSet.has(`${key}.${col.column_name}`);
      const fkRef = fkMap.get(`${key}.${String(col.column_name)}`);
      const scalar = pgTypeToScalar(col.udt_name as string);
      const column: Column = {
        name: col.column_name as string,
        label: humanize(col.column_name as string),
        type: scalar,
        nullable: col.is_nullable === "YES",
        isPrimaryKey: isPK,
        isForeignKey: !!fkRef,
        references: fkRef,
      };
      column.role = inferRole(column, col.udt_name as string);
      tableMap.get(key)!.push(column);
    }

    // Apply include/exclude filters
    const include = this.config.include;
    const exclude = new Set(this.config.exclude ?? []);
    const tables = [...tableMap.keys()].filter(t => {
      if (exclude.has(t)) return false;
      if (include && !include.includes(t)) return false;
      return true;
    });

    // Build entities with sample data in parallel
    const sampleSize = this.config.sampleSize ?? 5;
    const entities: Entity[] = await Promise.all(
      tables.map(async (table): Promise<Entity> => {
        const cols = tableMap.get(table)!;
        let sample: Row[] = [];
        try {
          const res = await this.client.query(
            `SELECT * FROM "${table}" LIMIT $1`, [sampleSize]
          );
          sample = res.rows;
        } catch (_) {}
        return {
          name: table,
          label: humanize(table),
          sourceName: table,
          columns: cols,
          rowCount: counts.get(table),
          sample,
        };
      })
    );

    // Build relationships from FK data
    const relationships: Relationship[] = fks
      .filter(fk => tables.includes(fk.table_name as string) && tables.includes(fk.foreign_table_name as string))
      .map(fk => ({
        from: { entity: fk.table_name as string, column: fk.column_name as string },
        to: { entity: fk.foreign_table_name as string, column: fk.foreign_column_name as string },
        type: "many-to-one",
      }));

    // Auto-infer metrics from numeric non-pk columns
    const metrics: Metric[] = [];
    for (const entity of entities) {
      for (const col of entity.columns) {
        if (col.role === "metric" && !col.isPrimaryKey && !col.isForeignKey) {
          metrics.push({
            name: `${entity.name}_${col.name}_sum`,
            label: `Total ${entity.label} ${col.label}`,
            expression: `SUM("${entity.name}"."${col.name}")`,
            entity: entity.name,
            aggregation: "sum",
          });
        }
      }
    }

    return {
      entities,
      relationships,
      metrics,
      source: { type: "postgres" },
    };
  }

  // ── Private query helpers ────────────────────────────────────────────────────

  private async fetchColumns(): Promise<Row[]> {
    const schema = "public";
    const result = await this.client.query(`
      SELECT c.table_name, c.column_name, c.udt_name, c.is_nullable, c.ordinal_position
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = $1
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position
    `, [schema]);
    return result.rows;
  }

  private async fetchPrimaryKeys(): Promise<Row[]> {
    const result = await this.client.query(`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
    `);
    return result.rows;
  }

  private async fetchForeignKeys(): Promise<Row[]> {
    const result = await this.client.query(`
      SELECT
        kcu.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `);
    return result.rows;
  }

  private async fetchRowCounts(): Promise<Map<string, number>> {
    const result = await this.client.query(`
      SELECT relname AS table_name, reltuples::bigint AS row_count
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE nspname = 'public' AND relkind = 'r'
    `);
    return new Map(result.rows.map(r => [r.table_name as string, Number(r.row_count)]));
  }
}

