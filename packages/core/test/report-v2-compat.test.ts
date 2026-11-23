import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateReport } from "./schema.js";

// Report v2 compatibility (CORE-132, AGENTS.md rule 2): within v2 nothing is removed, renamed or retyped.
// 1. Every report committed under fixtures/ (report*.json) validates against the current schema/report.v2.json, so a
//    removed or retyped property, or a narrowed enum, fails here.
// 2. Every message code a release shipped, listed append-only in fixtures/release/codes.txt (docs/RELEASING.md), is
//    still a MessageCode member in report.ts and still named by the schema's message-code description.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

describe("Report v2 compatibility", () => {
  it("every committed report fixture is a v2 report that validates against schema/report.v2.json", () => {
    const files = readdirSync(join(ROOT, "fixtures"), { recursive: true, encoding: "utf8" })
      .map((name) => `fixtures/${name.split("\\").join("/")}`)
      .filter((path) => /(?:^|\/)report[^/]*\.json$/.test(path))
      .sort();
    expect(files.length, "the committed report fixtures").toBeGreaterThanOrEqual(12);
    for (const path of files) {
      const report = JSON.parse(read(path)) as { schemaVersion?: unknown };
      expect(report.schemaVersion, `${path}: schemaVersion`).toBe(2);
      expect(validateReport(report), `${path}: ${JSON.stringify(validateReport.errors)}`).toBe(true);
    }
  });

  it("every released message code is still a MessageCode in report.ts and named by the schema", () => {
    const released = read("fixtures/release/codes.txt")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(released.length, "the codes of v0.10.0 and later").toBeGreaterThanOrEqual(89);
    expect(new Set(released).size, "no code is listed twice").toBe(released.length);
    for (const code of released) expect(code, "a code word").toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/);

    const union = /export type MessageCode =([\s\S]*?);/.exec(read("packages/core/src/report.ts"))?.[1] ?? "";
    const inCode = new Set([...union.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]));
    const schema = JSON.parse(read("schema/report.v2.json")) as {
      $defs: { message: { properties: { code: { description: string } } } };
    };
    const inSchema = new Set(schema.$defs.message.properties.code.description.match(CODE));
    expect(
      released.filter((code) => !inCode.has(code)),
      "released codes missing from MessageCode in report.ts",
    ).toEqual([]);
    expect(
      released.filter((code) => !inSchema.has(code)),
      "released codes missing from the schema",
    ).toEqual([]);
  });
});
