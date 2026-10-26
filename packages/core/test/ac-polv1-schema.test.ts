import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

// The schema is read inside the test body: the build writes it, after this test.

const ROOT = new URL("../../../", import.meta.url);

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every subschema reachable through `properties` values, `items`, `anyOf` entries and `$defs` values, root included. */
function subschemas(root: Node): Node[] {
  const out: Node[] = [];
  const visit = (node: Node) => {
    out.push(node);
    if (isNode(node.properties)) for (const child of Object.values(node.properties)) if (isNode(child)) visit(child);
    if (isNode(node.items)) visit(node.items);
    if (Array.isArray(node.anyOf)) for (const child of node.anyOf) if (isNode(child)) visit(child);
    if (isNode(node.$defs)) for (const child of Object.values(node.$defs)) if (isNode(child)) visit(child);
  };
  visit(root);
  return out;
}

describe("schema/policy.v1.json", () => {
  it("AC-1: compiles under strict Ajv2020, is draft 2020-12 with the policy $id, requires only version (const 1), and every node is closed, bounded and described", () => {
    const schema = JSON.parse(readFileSync(new URL("schema/policy.v1.json", ROOT), "utf8")) as Node;

    expect(() => new Ajv2020({ strict: true, allErrors: true }).compile(schema)).not.toThrow();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe("https://pharn.dev/schemas/ci/policy.v1.json");
    expect(schema.required).toEqual(["version"]);
    const properties = schema.properties as Record<string, Node>;
    expect(properties.version?.const).toBe(1);

    const nodes = subschemas(schema);
    const objects = nodes.filter((n) => n.type === "object");
    const arrays = nodes.filter((n) => n.type === "array");
    const strings = nodes.filter((n) => n.type === "string" && !("enum" in n) && !("const" in n));
    // The walk must actually reach the schema's nested shape, or the rules below would hold vacuously.
    expect(objects.length).toBeGreaterThanOrEqual(10);
    expect(arrays.length).toBeGreaterThanOrEqual(10);
    expect(strings.length).toBeGreaterThanOrEqual(5);

    for (const node of objects) expect(node.additionalProperties).toBe(false);
    for (const node of arrays) expect(typeof node.maxItems).toBe("number");
    for (const node of strings) expect(typeof node.maxLength).toBe("number");

    let described = 0;
    for (const node of nodes) {
      if (!isNode(node.properties)) continue;
      for (const [key, child] of Object.entries(node.properties)) {
        const description = isNode(child) ? child.description : undefined;
        expect(typeof description === "string" && description.trim().length > 0, `property ${key}`).toBe(true);
        described++;
      }
    }
    expect(described).toBeGreaterThanOrEqual(40);
  });
});
