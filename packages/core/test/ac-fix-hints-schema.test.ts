import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateReport } from "./schema.js";

// fix-hints (H6), AC-8. Reads schema/report.v2.json and schema/report.v1.json and compares them with the base commit
// through git; nothing the build adds is loaded.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "7d88076280ec86435c3f84ad3c6102e272ab64d5";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

const KINDS = [
  "add-test",
  "restore-test",
  "restore-assertion",
  "revert-config",
  "remove-dependency",
  "request-review",
  "split-pr",
  "none",
];

type Node = {
  $ref?: string;
  description?: string;
  type?: unknown;
  additionalProperties?: unknown;
  required?: string[];
  properties?: Record<string, Node>;
  items?: Node;
  enum?: unknown[];
  maxLength?: number;
};
type Schema = Node & { $defs: Record<string, Node> };

/** A node with a local `$ref` resolved against the schema's $defs. */
function resolve(schema: Schema, node: Node): Node {
  if (node.$ref === undefined) return node;
  const match = /^#\/\$defs\/([^/]+)$/.exec(node.$ref);
  expect(match, `a local $defs reference: ${node.$ref}`).not.toBeNull();
  const target = schema.$defs[match?.[1] ?? ""];
  expect(target, `${node.$ref} resolves`).toBeDefined();
  return target as Node;
}

/** The objects that carry an optional fix: the message definition and the five finding item schemas. */
function owners(schema: Schema): Array<[string, Node]> {
  const p = schema.properties ?? {};
  return [
    ["$defs.message", schema.$defs.message as Node],
    ["testIntegrity.signals[]", p.testIntegrity?.properties?.signals?.items as Node],
    ["policy.violations[]", p.policy?.properties?.violations?.items as Node],
    ["setupHealth.stale[]", p.setupHealth?.properties?.stale?.items as Node],
    ["injection.signals[]", p.injection?.properties?.signals?.items as Node],
    ["dependencies.signals[]", p.dependencies?.properties?.signals?.items as Node],
  ];
}

/** Every `required` list of a JSON value, keyed by its JSON pointer. */
function requiredLists(value: unknown, pointer = "", out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      requiredLists(v, `${pointer}/${i}`, out);
    });
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "required" && Array.isArray(v)) out.set(pointer, JSON.stringify(v));
      requiredLists(v, `${pointer}/${key}`, out);
    }
  }
  return out;
}

describe("schema/report.v2.json: the optional fix object", () => {
  it("AC-8: the message definition and the five finding item schemas each carry an optional, closed fix object with required kind and hint, optional target, kind the closed enum and hint at most 200 characters, each described as never lowering a gate", () => {
    const schema = JSON.parse(read("schema/report.v2.json")) as Schema;
    for (const [where, owner] of owners(schema)) {
      expect(owner, `${where} exists`).toBeDefined();
      const property = owner.properties?.fix;
      expect(property, `${where} has a fix property`).toBeDefined();
      if (property === undefined) continue;
      expect(owner.required ?? [], `${where}: fix is optional`).not.toContain("fix");
      const description = property.description ?? resolve(schema, property).description ?? "";
      expect(description, `${where}: the description says no kind lowers a gate`).toMatch(/lowers? a gate/i);

      const fix = resolve(schema, property);
      expect(fix.type, `${where}: an object`).toBe("object");
      expect(fix.additionalProperties, `${where}: closed`).toBe(false);
      expect([...(fix.required ?? [])].sort(), `${where}: required`).toEqual(["hint", "kind"]);
      expect(Object.keys(fix.properties ?? {}).sort(), `${where}: properties`).toEqual(["hint", "kind", "target"]);
      expect(fix.properties?.kind?.enum, `${where}: kind enum`).toEqual(KINDS);
      expect(fix.properties?.hint?.type, `${where}: hint type`).toBe("string");
      expect(fix.properties?.hint?.maxLength, `${where}: hint maxLength`).toBe(200);
      expect(fix.properties?.target?.type, `${where}: target type`).toBe("string");
    }
  });

  it("AC-8: every required list is unchanged from the base commit, a report without fix still validates, and schema/report.v1.json is byte-identical to the base commit", () => {
    const current = JSON.parse(read("schema/report.v2.json")) as Schema;
    const base = JSON.parse(git("show", `${BASE}:schema/report.v2.json`)) as Schema;
    // The schema gained the fix object: this criterion is about the increment, not the base alone.
    expect(owners(current)[0]?.[1].properties?.fix, "the increment is present").toBeDefined();

    const before = requiredLists(base);
    const after = requiredLists(current);
    for (const [pointer, list] of before) expect(after.get(pointer), `required at ${pointer || "/"}`).toBe(list);
    for (const pointer of after.keys()) {
      if (!before.has(pointer))
        expect(pointer, "a new required list belongs to $defs/fix").toMatch(/^\/\$defs\/fix(\/|$)/);
    }

    // A report of the previous shape: the golden report at the base commit, with no fix anywhere.
    const previous = JSON.parse(git("show", `${BASE}:fixtures/golden/report.json`)) as unknown;
    expect(JSON.stringify(previous)).not.toContain('"fix"');
    expect(validateReport(previous), JSON.stringify(validateReport.errors)).toBe(true);

    expect(read("schema/report.v1.json")).toBe(git("show", `${BASE}:schema/report.v1.json`));
  });
});
