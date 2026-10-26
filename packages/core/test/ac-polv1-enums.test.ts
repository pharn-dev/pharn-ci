import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The schema and the policy exports are read inside the test body: the build writes them, after this test.

const ROOT = new URL("../../../", import.meta.url);

type Node = Record<string, unknown>;

describe("schema/policy.v1.json enums and the core entry point", () => {
  it("AC-11: setup.expect equals AGENT_TOOLS, test_integrity.mode equals TEST_INTEGRITY_MODES, and the limits and functions are exported", async () => {
    const schema = JSON.parse(readFileSync(new URL("schema/policy.v1.json", ROOT), "utf8")) as Node;
    const defs = (schema.$defs ?? {}) as Record<string, Node>;
    /** The node itself, or the `$defs` entry its `#/$defs/<name>` `$ref` points at. */
    const resolve = (node: Node | undefined): Node | undefined => {
      const ref = node?.$ref;
      if (typeof ref === "string" && ref.startsWith("#/$defs/")) return defs[ref.slice("#/$defs/".length)];
      return node;
    };
    const props = (node: Node | undefined) => (resolve(node)?.properties ?? {}) as Record<string, Node>;

    const top = props(schema);
    const expectItems = resolve(resolve(props(top.setup).expect)?.items as Node | undefined);
    const mode = resolve(props(top.test_integrity).mode);

    const core = await import("@pharn-ci/core");
    expect(expectItems?.enum).toEqual([...core.AGENT_TOOLS]);
    expect(mode?.enum).toEqual([...core.TEST_INTEGRITY_MODES]);
    expect(core.POLICY_MAX_CHARS).toBe(262144);
    expect(core.POLICY_MAX_ERRORS).toBe(50);
    expect(typeof core.validatePolicy).toBe("function");
    expect(typeof core.parsePolicyJson).toBe("function");
  });
});
