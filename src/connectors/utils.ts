import type { Row } from "../types.js";

export function humanize(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── PII redaction ───────────────────────────────────────────────────────────────

const PII_COLUMN_PATTERNS = [
  /password/i, /passwd/i, /secret/i, /api_key/i, /apikey/i,
  /token/i, /ssn/i, /social_security/i, /credit_card/i, /card_number/i,
  /cvv/i, /pin\b/i, /private_key/i, /access_key/i, /auth_token/i,
];

export function redactPiiColumns(rows: Row[]): Row[] {
  if (!rows.length) return rows;
  const keys = Object.keys(rows[0]);
  const sensitiveKeys = keys.filter(k => PII_COLUMN_PATTERNS.some(re => re.test(k)));
  if (!sensitiveKeys.length) return rows;
  return rows.map(row => {
    const clean = { ...row };
    for (const k of sensitiveKeys) clean[k] = "[REDACTED]";
    return clean;
  });
}
