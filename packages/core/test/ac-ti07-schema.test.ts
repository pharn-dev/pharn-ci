import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport, validateReport } from "./schema.js";

// The schema files are read inside each test body and compared with the base commit d73684d through git (CI checks
// out the full history). check() is loaded inside the body too: the AC tests are written before
// testIntegrity.changes exists in the schema.

const BASE = "d73684d7b8c7841e28611758dd510f06aea35335";
const ROOT = new URL("../", `file://${FIXTURES}`).pathname;
const REPO_ROOT = "/home/runner/work/demo/demo";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const atBase = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8" });
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

/** The TI07 entry of the message-code description: from TEST_INTEGRITY_TI07 to the next TEST_INTEGRITY_ code. */
function ti07Entry(description: string): string {
  const at = description.indexOf("TEST_INTEGRITY_TI07");
  if (at === -1) return "";
  const rest = description.slice(at + "TEST_INTEGRITY_TI07".length);
  const next = rest.search(/TEST_INTEGRITY_[A-Z0-9_]+/);
  return next === -1 ? rest : rest.slice(0, next);
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
    const { check } = await import("../src/check.js");
    const report = structuredClone(
      check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: fixture("golden/files.txt").trim().split("\n"),
        testIntegrityMode: { input: "warn" },
      } as unknown as Parameters<typeof check>[0]),
    ) as unknown as { testIntegrity: Record<string, unknown> };
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

  it("AC-13: the message-code description names TEST_INTEGRITY_TI07 with its level warn, every other v2 text is unchanged, and v1 is byte-identical to the base commit", () => {
    const head = JSON.parse(live("schema/report.v2.json")) as Obj;
    const base = JSON.parse(atBase("schema/report.v2.json")) as Obj;
    const code = (s: Obj) => ((((s.$defs as Obj).message as Obj).properties as Obj).code as Obj).description as string;

    const description = code(head);
    expect(code(base)).not.toContain("TEST_INTEGRITY_TI07");
    expect(description).toContain("TEST_INTEGRITY_TI07");
    expect(ti07Entry(description), "the TI07 entry names its level").toMatch(/\bwarn\b/);

    // Set aside the message-code description and the new changes property; everything else is the base's.
    const strip = (s: Obj) => {
      const copy = structuredClone(s) as Obj;
      ((((copy.$defs as Obj).message as Obj).properties as Obj).code as Obj).description = "<set aside>";
      delete (((copy.properties as Obj).testIntegrity as Obj).properties as Obj).changes;
      // agent-pr-detection (E3 item 24a) adds the optional meta.isAgentPr property
      delete (((copy.properties as Obj).meta as Obj).properties as Obj).isAgentPr;
      return copy;
    };
    expect(strip(head)).toEqual(strip(base));

    expect(live("schema/report.v1.json"), "schema/report.v1.json is byte-identical").toBe(
      atBase("schema/report.v1.json"),
    );
  });
});
