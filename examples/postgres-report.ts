/**
 * Example: Generate a charts report from a Postgres database
 * and publish it as an embeddable iframe.
 *
 * Run: npx ts-node examples/postgres-report.ts
 */
import { createSDK } from "../src/index.js";

async function main() {
  const sdk = createSDK({
    anthropicKey: process.env.ANTHROPIC_API_KEY!,
    publish: {
      baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
      secret: process.env.REPORT_SECRET ?? "dev-secret",
      tokenTtl: 0, // never expire in dev
    },
  });

  console.log("🔍 Introspecting schema...");
  const model = await sdk.introspect({
    type: "postgres",
    connectionString: process.env.DATABASE_URL!,
  });

  console.log(`📊 Found ${model.entities.length} entities:`);
  model.entities.forEach(e => {
    console.log(`  - ${e.label} (${e.rowCount?.toLocaleString() ?? "?"} rows)`);
  });

  console.log("\n⚡ Generating report...");
  const published = await sdk.generateAndPublish(
    {
      type: "postgres",
      connectionString: process.env.DATABASE_URL!,
    },
    {
      prompt: "Build a comprehensive analytics dashboard showing key metrics, trends, and breakdowns across all entities.",
      mode: "charts",
      style: "dark",
    }
  );

  console.log("\n✅ Report published!");
  console.log("URL:", published.url);
  console.log("\niframe embed:\n", published.iframeCode);
  console.log("\nExpires:", published.expiresAt ?? "never");
}

main().catch(console.error);
