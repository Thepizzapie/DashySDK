import { describe, it, expect } from "vitest";
import { redactPiiColumns } from "../../src/connectors/utils.js";

describe("redactPiiColumns", () => {
  it("redacts password columns", () => {
    const rows = [{ id: 1, password: "secret123", name: "Alice" }];
    const result = redactPiiColumns(rows);
    expect(result[0].password).toBe("[REDACTED]");
    expect(result[0].id).toBe(1);
    expect(result[0].name).toBe("Alice");
  });

  it("redacts token columns — api_token, auth_token, access_token", () => {
    const rows = [{ api_token: "tok1", auth_token: "tok2", access_token: "tok3", label: "x" }];
    const result = redactPiiColumns(rows);
    expect(result[0].api_token).toBe("[REDACTED]");
    expect(result[0].auth_token).toBe("[REDACTED]");
    expect(result[0].access_token).toBe("[REDACTED]");
    expect(result[0].label).toBe("x");
  });

  it("redacts ssn and social_security_number", () => {
    const rows = [{ ssn: "123-45-6789", social_security_number: "987-65-4321", name: "Bob" }];
    const result = redactPiiColumns(rows);
    expect(result[0].ssn).toBe("[REDACTED]");
    expect(result[0].social_security_number).toBe("[REDACTED]");
    expect(result[0].name).toBe("Bob");
  });

  it("is case insensitive — PASSWORD, Password, passWord all redacted", () => {
    const rows = [{ PASSWORD: "a", Password: "b", passWord: "c", id: 1 }];
    const result = redactPiiColumns(rows);
    expect(result[0].PASSWORD).toBe("[REDACTED]");
    expect(result[0].Password).toBe("[REDACTED]");
    expect(result[0].passWord).toBe("[REDACTED]");
    expect(result[0].id).toBe(1);
  });

  it("safe columns untouched — id, name, email, created_at, total are not redacted", () => {
    const rows = [{ id: 42, name: "Carol", email: "carol@example.com", created_at: "2024-01-01", total: 99.5 }];
    const result = redactPiiColumns(rows);
    expect(result[0]).toEqual({ id: 42, name: "Carol", email: "carol@example.com", created_at: "2024-01-01", total: 99.5 });
  });

  it("returns empty array unchanged", () => {
    expect(redactPiiColumns([])).toEqual([]);
  });

  it("applies redaction consistently to all rows", () => {
    const rows = [
      { id: 1, password: "pw1", name: "Alice" },
      { id: 2, password: "pw2", name: "Bob" },
      { id: 3, password: "pw3", name: "Carol" },
    ];
    const result = redactPiiColumns(rows);
    expect(result).toHaveLength(3);
    for (const row of result) {
      expect(row.password).toBe("[REDACTED]");
    }
    expect(result[0].name).toBe("Alice");
    expect(result[1].name).toBe("Bob");
    expect(result[2].name).toBe("Carol");
  });
});
