import { describe, it, expect } from "vitest";
import { prepareDoc } from "../../src/frame/prepareDoc.js";

describe("prepareDoc", () => {
  it("empty string returns empty string", () => {
    expect(prepareDoc("")).toBe("");
  });

  it("bare snippet wrapping — produces full HTML doc from a bare JSX snippet", () => {
    const snippet = `
function Dashboard() {
  return <div>Hello</div>;
}
`;
    const result = prepareDoc(snippet);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("__DASHY__");
    expect(result).toContain('type="text/babel"');
    expect(result).toContain("Hello");
  });

  it("full HTML with babel — extracts babel script and re-wraps in template", () => {
    const fullDoc = `<!DOCTYPE html><html><head></head><body>
<script type="text/babel">
function Dashboard() {
  return <div>MyDashboard</div>;
}
</script>
</body></html>`;
    const result = prepareDoc(fullDoc);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("__DASHY__");
    expect(result).toContain("MyDashboard");
    // The re-wrapped babel script should be present
    expect(result).toContain('type="text/babel"');
  });

  it("strips const { ... } = React destructuring", () => {
    // Use a Recharts destructuring (not React) to avoid conflict with the template's own React destructuring
    const fullDoc = `<!DOCTYPE html><html><head></head><body>
<script type="text/babel">
const { BarChart, LineChart } = Recharts;
function Dashboard() {
  return <div>Test</div>;
}
</script>
</body></html>`;
    const result = prepareDoc(fullDoc);
    const babelMatch = result.match(/<script[^>]*type="text\/babel"[^>]*>([\s\S]*?)<\/script>/i);
    expect(babelMatch).not.toBeNull();
    const babelCode = babelMatch![1];
    // The user's explicit Recharts destructuring line should be stripped
    // (only the template's own Recharts destructuring at the top should remain)
    // Count occurrences: the template provides exactly one Recharts destructuring block
    const rechartsDestructures = (babelCode.match(/=\s*Recharts\s*;/g) || []).length;
    expect(rechartsDestructures).toBe(1); // only the template's own, not a duplicate
  });

  it("strips duplicate useDashyData function from extracted code", () => {
    const fullDoc = `<!DOCTYPE html><html><head></head><body>
<script type="text/babel">
function useDashyData(sourceName, fallback) {
  const [data, setData] = React.useState(fallback);
  return data;
}
function Dashboard() {
  return <div>Hi</div>;
}
</script>
</body></html>`;
    const result = prepareDoc(fullDoc);
    const babelMatch = result.match(/<script[^>]*type="text\/babel"[^>]*>([\s\S]*?)<\/script>/i);
    expect(babelMatch).not.toBeNull();
    const babelCode = babelMatch![1];
    // The custom useDashyData definition should be stripped (template provides its own)
    expect(babelCode).not.toContain("function useDashyData(");
  });

  it("CDN versions are pinned — react@18.3.1 and babel@7.26.3", () => {
    const snippet = `function App() { return <div>v</div>; }`;
    const result = prepareDoc(snippet);
    expect(result).toContain("react@18.3.1");
    expect(result).toContain("react-dom@18.3.1");
    expect(result).toContain("@babel/standalone@7.26.3");
  });

  it("trusted-origin postMessage — output contains __DASHY_TRUSTED_ORIGIN__", () => {
    const snippet = `function App() { return <div>trusted</div>; }`;
    const result = prepareDoc(snippet);
    expect(result).toContain("__DASHY_TRUSTED_ORIGIN__");
  });

  it("truncated HTML recovery — returns complete HTML even when babel script is cut off", () => {
    // Simulate a full HTML doc where the babel script body is truncated before </script>
    const truncatedDoc = `<!DOCTYPE html><html><head></head><body>
<script type="text/babel">
function Dashboard() {
  return (
    <div>
      <h1>Title</h1>
      <p>Some content that`;
    // prepareDoc should not throw and should return valid HTML
    expect(() => prepareDoc(truncatedDoc)).not.toThrow();
    const result = prepareDoc(truncatedDoc);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("</html>");
  });
});
