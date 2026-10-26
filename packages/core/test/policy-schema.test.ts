import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { POLICY_PATTERNS } from "../src/policy/grammar.js";
import { validatePolicy } from "../src/policy/validate.js";

const SCHEMA_URL = new URL("../../../schema/policy.v1.json", import.meta.url);

function readSchema(): unknown {
  return JSON.parse(readFileSync(SCHEMA_URL, "utf8"));
}

/** Every `pattern` string in the schema, wherever it sits. */
function collectPatterns(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectPatterns(item, found);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "pattern" && typeof value === "string") found.push(value);
      else collectPatterns(value, found);
    }
  }
  return found;
}

const EMOJI = "\u{1F600}";

describe("schema/policy.v1.json and the validator's grammars", () => {
  it("every pattern in the schema is one of POLICY_PATTERNS, and every POLICY_PATTERNS value is used", () => {
    const sources = Object.values(POLICY_PATTERNS) as string[];
    const found = collectPatterns(readSchema());
    expect(found.length).toBeGreaterThan(0);
    for (const pattern of found) expect(sources, pattern).toContain(pattern);
    for (const source of sources) expect(found, source).toContain(source);
  });

  it("Ajv and validatePolicy agree on every length boundary, and both give the expected verdict", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(readSchema() as object);
    const doc = (section: string, key: string, value: unknown) => ({ version: 1, [section]: { [key]: value } });
    const cases: ReadonlyArray<readonly [string, unknown, boolean]> = [
      [
        "labels 1000 items",
        doc(
          "agents",
          "labels",
          Array.from({ length: 1000 }, () => "a"),
        ),
        true,
      ],
      [
        "labels 1001 items",
        doc(
          "agents",
          "labels",
          Array.from({ length: 1001 }, () => "a"),
        ),
        false,
      ],
      ["glob 512", doc("coverage", "exclude", ["a".repeat(512)]), true],
      ["glob 513", doc("coverage", "exclude", ["a".repeat(513)]), false],
      ["name 128 astral", doc("setup", "allowed_mcp_servers", [EMOJI.repeat(128)]), true],
      ["name 129 astral", doc("setup", "allowed_mcp_servers", [EMOJI.repeat(129)]), false],
      ["label 50 astral", doc("agents", "labels", [EMOJI.repeat(50)]), true],
      ["label 51 astral", doc("agents", "labels", [EMOJI.repeat(51)]), false],
      ["login 44", doc("agents", "extra_logins", [`${"a".repeat(39)}[bot]`]), true],
      ["login 40 letters", doc("agents", "extra_logins", ["a".repeat(40)]), false],
      ["event 64", doc("setup", "required_hooks", [{ event: "E".repeat(64) }]), true],
      ["event 65", doc("setup", "required_hooks", [{ event: "E".repeat(65) }]), false],
      ["perm 512", doc("setup", "forbidden_permissions", [`B(${"x".repeat(509)})`]), true],
      ["perm 513", doc("setup", "forbidden_permissions", [`B(${"x".repeat(510)})`]), false],
      ["root 512", doc("coverage", "root", "r".repeat(512)), true],
      ["root 513", doc("coverage", "root", "r".repeat(513)), false],
      ["lone surrogate", doc("setup", "allowed_mcp_servers", ["a\ud800b"]), true],
    ];
    for (const [name, value, expected] of cases) {
      expect(validate(value) === true, `Ajv: ${name}`).toBe(expected);
      expect(validatePolicy(value).ok, `validatePolicy: ${name}`).toBe(expected);
    }
  });
});
