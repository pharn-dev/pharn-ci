import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Reads the repository files. findSecretSpans() is loaded inside the test body: the AC test is written before the
// redaction module exists, so nothing the build adds may run while the file loads. (CORE-132: the report.v1.json
// comparison with an old commit was a history pin and is removed, and so is ac-secrets-repin.test.ts from TEST_FILES.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const CODES = [
  ...Array.from({ length: 11 }, (_, i) => `AGENT_CONFIG_SECRET_S${String(i + 1).padStart(2, "0")}`),
  "AGENT_CONFIG_SECRET_UNSCANNED",
];

/** The AC test files of this change, as AC-TESTS.md maps them. */
const TEST_FILES = [
  "packages/core/test/ac-secrets-spans.test.ts",
  "packages/core/test/ac-secrets-redact.test.ts",
  "packages/core/test/ac-secrets-scan.test.ts",
  "packages/core/test/ac-secrets-check.test.ts",
  "packages/node-io/test/ac-secrets-reader.test.ts",
  "packages/cli/test/ac-secrets-cli.test.ts",
  "packages/action/test/ac-secrets-action.test.ts",
  "packages/core/test/ac-secrets-growth.test.ts",
  "packages/core/test/ac-secrets-exports.test.ts",
  "packages/core/test/ac-secrets-docs.test.ts",
  "packages/action/test/ac-secrets-fakes.test.ts",
];

/** The description string of the schema's message `code` property. */
function messageCodeDescription(schema: string): string {
  const parsed = JSON.parse(schema) as unknown;
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (
          key === "description" &&
          typeof value === "string" &&
          value.includes("No code is removed or renamed before 1.0.")
        ) {
          found.push(value);
        }
        walk(value);
      }
    }
  };
  walk(parsed);
  expect(found, "one message-code description").toHaveLength(1);
  return found[0] as string;
}

// CORE-133: the README, LIMITS, THREAT-MODEL and CHANGELOG wording checks moved out; docs-contract.test.ts checks
// the README code rows.
describe("A7 schema and fixtures", () => {
  it("AC-22: the schema documents A7, and no committed fixture or test holds a secret", async () => {
    const { findSecretSpans } = (await import("../src/index.js")) as unknown as {
      findSecretSpans(text: string): { id: string; start: number; end: number }[];
    };

    // schema/report.v2.json names the 12 codes after "Codes added in v0.4.0:".
    const description = messageCodeDescription(read("schema/report.v2.json"));
    const added = description.indexOf("Codes added in v0.4.0:");
    expect(added, "the description holds Codes added in v0.4.0:").toBeGreaterThan(-1);
    for (const code of CODES) expect(description.slice(added), `the v0.4.0 text names ${code}`).toContain(code);

    // No committed fixture under fixtures/secrets/ and no AC test file of this change holds a span.
    const fixtureDir = join(ROOT, "fixtures/secrets");
    const fixtures = readdirSync(fixtureDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    expect(fixtures.length, "fixtures/secrets/ holds the templates").toBeGreaterThan(0);
    for (const path of [...fixtures, ...TEST_FILES.map((file) => join(ROOT, file))]) {
      expect(findSecretSpans(readFileSync(path, "utf8")), path).toEqual([]);
    }
  });
});
