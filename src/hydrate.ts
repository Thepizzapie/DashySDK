import type { Row } from "./types.js";

const SENTINEL_RE = /\/\*DASHY_DATA:(\w+)\*\/[\s\S]*?\/\*END_DASHY_DATA\*\//g;

/**
 * Extract all entity names that have sentinel markers in the HTML.
 */
export function extractSentinelKeys(html: string): string[] {
  const keys: string[] = [];
  const re = /\/\*DASHY_DATA:(\w+)\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

/**
 * Replace sentinel-wrapped sample arrays with full dataset rows.
 * Skips any key not present in fullData.
 */
export function hydrateHtml(
  html: string,
  fullData: Record<string, Row[]>
): string {
  if (!html.includes("/*DASHY_DATA:")) return html;
  return html.replace(SENTINEL_RE, (original, key: string) => {
    const rows = fullData[key];
    if (!rows) return original; // no data for this key — leave sample in place
    return `/*DASHY_DATA:${key}*/${JSON.stringify(rows)}/*END_DASHY_DATA*/`;
  });
}
