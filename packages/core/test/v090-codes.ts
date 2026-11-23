// v0.9.0 fix hints (H6): every message and every finding of Report v2 carries an optional `fix` object. Tests that
// compare a report, or a golden report.json, with a value written before the fix objects existed compute it over
// `withoutFix(...)` or `withoutFixJson(...)`. (CORE-132 removed the schema-text helpers that only the history pins
// used; the file name stays so the tests that import these two helpers are left as they are.)

/**
 * A deep copy of `value` with every own `fix` property removed whose value is an object with a string `kind` and a
 * string `hint` (the report has no other `fix` key). The input is not changed.
 */
export function withoutFix<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutFix(item)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "fix" && isFixObject(item)) continue;
      out[key] = withoutFix(item);
    }
    return out as T;
  }
  return value;
}

function isFixObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === "string" && typeof record.hint === "string";
}

/** A report.json text with its `fix` objects taken out, written the way the goldens are written. */
export function withoutFixJson(text: string): string {
  return `${JSON.stringify(withoutFix(JSON.parse(text) as unknown), null, 2)}\n`;
}
