import type {
  Connector, GraphQLSourceConfig, SemanticModel,
  Entity, Column, Relationship, Row, ScalarType,
} from "../types.js";
import { humanize } from "./utils.js";

// Block RFC-1918 / loopback addresses to prevent SSRF
function assertNotPrivateHost(endpoint: string): void {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    if (isPrivateHost(host)) {
      throw new Error(`Connection to private/loopback host blocked: ${host}`);
    }
  } catch (e: unknown) {
    if ((e as Error).message?.startsWith("Connection to private")) throw e;
  }
}

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "::1") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

// ── GQL scalar mapping ─────────────────────────────────────────────────────────

function gqlTypeToScalar(typeName: string): ScalarType {
  switch (typeName) {
    case "Int": case "Float": case "BigDecimal": case "Long": return "number";
    case "Boolean": return "boolean";
    case "String": case "ID": case "UUID": return "string";
    case "DateTime": case "Timestamp": return "datetime";
    case "Date": return "date";
    case "JSON": case "JSONObject": return "json";
    default: return "unknown";
  }
}

// ── GraphQL introspection query ────────────────────────────────────────────────

const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      types {
        kind name description
        fields(includeDeprecated: false) {
          name description
          type { ...TypeRef }
          args { name type { ...TypeRef } defaultValue }
        }
      }
    }
  }
  fragment TypeRef on __Type {
    kind name
    ofType { kind name ofType { kind name ofType { kind name } } }
  }
`;

function unwrapType(type: any): { name: string; isList: boolean } {
  let t = type;
  let isList = false;
  while (t.ofType) {
    if (t.kind === "LIST") isList = true;
    t = t.ofType;
  }
  return { name: t.name ?? "unknown", isList };
}

// ── GraphQL connector ──────────────────────────────────────────────────────────

export class GraphQLConnector implements Connector {
  private schema: any = null;

  constructor(private config: GraphQLSourceConfig) {
    assertNotPrivateHost(config.endpoint);
  }

  async connect() {
    // Verify connection by running a minimal query
    await this.gqlFetch("{ __typename }");
  }

  async disconnect() {}

  async query(gql: string, _params?: unknown[]): Promise<Row[]> {
    const result = await this.gqlFetch(gql);
    // Return the first array field in the response
    const data = result.data ?? {};
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (Array.isArray(val)) return val as Row[];
      if (val && typeof val === "object" && Array.isArray(val.nodes)) return val.nodes as Row[];
      if (val && typeof val === "object" && Array.isArray(val.edges)) {
        return val.edges.map((e: any) => e.node) as Row[];
      }
    }
    return [data];
  }

  async introspect(): Promise<SemanticModel> {
    const result = await this.gqlFetch(INTROSPECTION_QUERY);
    this.schema = result.data.__schema;

    const queryTypeName: string = this.schema.queryType?.name ?? "Query";
    const allTypes: any[] = this.schema.types ?? [];

    // Find query root type
    const queryType = allTypes.find((t: any) => t.name === queryTypeName);
    if (!queryType) throw new Error(`Could not find Query root type (${queryTypeName})`);

    // Each field on Query that returns a list type is a potential entity collection
    const entityFields = (queryType.fields ?? []).filter((f: any) => {
      const { isList } = unwrapType(f.type);
      if (!isList) return false;
      if (this.config.include) return this.config.include.includes(f.name);
      return true;
    });

    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    for (const field of entityFields) {
      const { name: typeName } = unwrapType(field.type);
      const objType = allTypes.find((t: any) => t.name === typeName && t.kind === "OBJECT");
      if (!objType) continue;

      const columns: Column[] = [];
      const nestedRefs: { column: string; entity: string }[] = [];

      for (const gqlField of (objType.fields ?? [])) {
        const { name: fieldTypeName, isList } = unwrapType(gqlField.type);
        const scalar = gqlTypeToScalar(fieldTypeName);
        const isScalar = scalar !== "unknown";
        const isNestedObject = !isScalar && !isList;
        const isNestedList = !isScalar && isList;

        if (isScalar) {
          columns.push({
            name: gqlField.name,
            label: humanize(gqlField.name),
            type: scalar,
            nullable: true,
            isPrimaryKey: gqlField.name === "id",
            isForeignKey: false,
            description: gqlField.description ?? undefined,
            role: gqlField.name === "id" ? "identifier"
              : scalar === "number" ? "metric"
              : scalar === "datetime" || scalar === "date" ? "timestamp"
              : "dimension",
          });
        } else if (isNestedObject) {
          // FK-like: field points to another entity
          const idCol = `${gqlField.name}Id`;
          columns.push({
            name: idCol,
            label: `${humanize(gqlField.name)} ID`,
            type: "string",
            nullable: true,
            isPrimaryKey: false,
            isForeignKey: true,
            references: { entity: fieldTypeName, column: "id" },
            role: "identifier",
          });
          nestedRefs.push({ column: idCol, entity: fieldTypeName });
        } else if (isNestedList) {
          // Inverse relationship — handled when we process the child type
        }
      }

      // Fetch sample data
      let sample: Row[] = [];
      if (this.config.sampleQueries?.[typeName]) {
        try {
          sample = await this.query(this.config.sampleQueries[typeName]);
          sample = sample.slice(0, 5);
        } catch (_) {}
      } else {
        // Auto-build a sample query for scalar fields only
        const scalarFields = columns.filter(c => !c.isForeignKey).map(c => c.name).join(" ");
        if (scalarFields) {
          try {
            const autoQuery = `{ ${field.name}(first: 5) { ${scalarFields} } }`;
            sample = (await this.query(autoQuery)).slice(0, 5);
          } catch (_) {}
        }
      }

      entities.push({
        name: typeName,
        label: humanize(typeName),
        sourceName: typeName,
        columns,
        sample,
        description: field.description ?? objType.description ?? undefined,
      });

      // Register relationships
      for (const ref of nestedRefs) {
        if (entityFields.some((ef: any) => unwrapType(ef.type).name === ref.entity)) {
          relationships.push({
            from: { entity: typeName, column: ref.column },
            to: { entity: ref.entity, column: "id" },
            type: "many-to-one",
          });
        }
      }
    }

    // Auto-infer metrics
    const metrics = entities.flatMap(entity =>
      entity.columns
        .filter(c => c.role === "metric" && !c.isPrimaryKey)
        .map(col => ({
          name: `${entity.name}_${col.name}_sum`,
          label: `Total ${entity.label} ${col.label}`,
          expression: `sum of ${col.name} in ${entity.name}`,
          entity: entity.name,
          aggregation: "sum" as const,
        }))
    );

    return {
      entities,
      relationships,
      metrics,
      source: { type: "graphql", name: this.config.endpoint },
    };
  }

  private async gqlFetch(query: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`GraphQL request failed: ${res.status}`);
      const json = await res.json() as any;
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}
