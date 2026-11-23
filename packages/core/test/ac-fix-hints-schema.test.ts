import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// fix-hints (H6), AC-8. Reads schema/report.v2.json; nothing the build adds is loaded. (CORE-132: the test that
// compared the required lists, the golden report and report.v1.json with an old commit was a history pin and is
// removed; report-v2-compat.test.ts validates every committed report against the current schema.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
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
});
