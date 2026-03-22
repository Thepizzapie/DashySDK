import type { Connector, DataSourceConfig } from "../types.js";
import { PostgresConnector } from "./postgres.js";
import { GraphQLConnector } from "./graphql.js";

export function createConnector(config: DataSourceConfig): Connector {
  switch (config.type) {
    case "postgres":
      return new PostgresConnector(config);
    case "graphql":
      return new GraphQLConnector(config);
    case "rest":
      throw new Error("REST connector coming soon — use inline source with pre-fetched data for now");
    case "inline":
      return new InlineConnector(config.model);
    default:
      throw new Error(`Unknown connector type`);
  }
}

import type { SemanticModel, Row } from "../types.js";
import { InlineSourceConfig } from "../types.js";

class InlineConnector implements Connector {
  constructor(private model: SemanticModel) {}
  async connect() {}
  async disconnect() {}
  async introspect() { return this.model; }
  async query(_q: string): Promise<Row[]> {
    throw new Error("Inline connector does not support arbitrary queries");
  }
}
