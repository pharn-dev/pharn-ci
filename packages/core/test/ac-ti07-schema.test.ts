import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport, validateReport } from "./schema.js";

// The schema files are read inside each test body. check() is loaded inside the body too: the AC tests are written
// before testIntegrity.changes exists in the schema.

const ROOT = new URL("../", `file://${FIXTURES}`).pathname;
const REPO_ROOT = "/home/runner/work/demo/demo";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const live = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const isObj = (v: Json | undefined): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every object schema under `node` (itself included), with its path. */
function objectSchemas(node: Json, path: string, out: Array<{ path: string; schema: Obj }> = []) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => {
      objectSchemas(child, `${path}[${i}]`, out);
    });
    return out;
  }
  if (!isObj(node)) return out;
  if (node.type === "object" || isObj(node.properties)) out.push({ path, schema: node });
  for (const [key, child] of Object.entries(node)) {
    if (key === "properties" && isObj(child)) {
      for (const [name, prop] of Object.entries(child)) objectSchemas(prop, `${path}.properties.${name}`, out);
    } else {
      objectSchemas(child, `${path}.${key}`, out);
    }
  }
  return out;
}

describe("schema/report.v2.json: testIntegrity.changes and TEST_INTEGRITY_TI07", () => {
  it("AC-13: v2 has an optional testIntegrity.properties.changes with additionalProperties false on every object and a description on each property", async () => {
    const v2 = JSON.parse(live("schema/report.v2.json")) as Obj;
    const testIntegrity = (v2.properties as Obj).testIntegrity as Obj;
    const changes = (testIntegrity.properties as Obj).changes;
    expect(isObj(changes), "testIntegrity.properties.changes").toBe(true);
    const c = changes as Obj;
    expect((testIntegrity.required as Json[]).includes("changes"), "changes is optional").toBe(false);
    expect(typeof c.description === "string" && c.description.length > 0, "changes has a description").toBe(true);
    for (const key of ["totals", "files", "added", "removed", "modified", "renamed", "truncated"]) {
      expect(Object.keys(c.properties as Obj), key).toContain(key);
    }

    const objects = objectSchemas(c, "changes");
    expect(objects.length).toBeGreaterThan(1);
    for (const { path, schema } of objects) {
      expect(schema.additionalProperties, `${path}: additionalProperties`).toBe(false);
      for (const [name, prop] of Object.entries((schema.properties as Obj) ?? {})) {
        const description = isObj(prop) ? prop.description : undefined;
        expect(typeof description === "string" && description.trim().length > 0, `${path}.${name}: description`).toBe(
          true,
        );
      }
    }

    // A report carrying a well-formed changes object validates; an extra key anywhere in it does not.
    const { check } = await import("./text-coverage.js");
    const checked = structuredClone(
      check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: fixture("golden/files.txt").trim().split("\n"),
        testIntegrityMode: { input: "warn" },
      }),
    );
    // The changes objects set below include invalid ones on purpose, so the report is held through a wider type.
    const report: { testIntegrity: { changes?: unknown } } = checked;
    const entry = { path: "src/a.test.ts", name: "a › new one", line: 4 };
    const good = {
      totals: { added: 1, removed: 0, modified: 0, renamed: 0 },
      files: [{ path: "src/a.test.ts", language: "ts", added: 1, removed: 0, modified: 0, renamed: 0 }],
      added: [entry],
      removed: [],
      modified: [],
      renamed: [],
    };
    report.testIntegrity.changes = good;
    expectValidReport(report);
    for (const bad of [
      { ...good, extra: 1 },
      { ...good, totals: { ...good.totals, extra: 1 } },
      { ...good, files: [{ ...good.files[0], extra: 1 }] },
      { ...good, added: [{ ...entry, extra: 1 }] },
    ]) {
      report.testIntegrity.changes = bad;
      expect(validateReport(report), JSON.stringify(bad)).toBe(false);
    }
  });

  // CORE-132: the comparisons of the rest of report.v2.json and of report.v1.json with an old commit were history pins
  // and are removed.
  // CORE-140: the schema's code description became one sentence and a link to the code table of docs/output.md, so the
  // TI07 row of that table is read.
  it("AC-13: the code table documents TEST_INTEGRITY_TI07 with its level warn", () => {
    expect(codeRow("TEST_INTEGRITY_TI07"), "the TI07 row names its level").toMatch(/`warn`/);
  });
});
