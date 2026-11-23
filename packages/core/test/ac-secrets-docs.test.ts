import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// Reads the repository files. findSecretSpans() is loaded inside the test body: the AC test is written before the
// redaction module exists, so nothing the build adds may run while the file loads. (CORE-132: the report.v1.json
// comparison with an old commit was a history pin and is removed, and so is ac-secrets-repin.test.ts from TEST_FILES.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

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

// CORE-133: the README, LIMITS, THREAT-MODEL and CHANGELOG wording checks moved out; docs-contract.test.ts checks
// the README code rows.
describe("A7 schema and fixtures", () => {
  it("AC-22: the schema documents A7, and no committed fixture or test holds a secret", async () => {
    const { findSecretSpans } = (await import("../src/secrets/spans.js")) as unknown as {
      findSecretSpans(text: string): { id: string; start: number; end: number }[];
    };

    // The code table names the 12 codes with their levels (CORE-140: the schema's code description is one sentence and
    // a link to that table, so the codes are documented there).
    for (const code of CODES) expect(codeRow(code), `${code}: the row states a level`).toMatch(/`(?:error|warn|info)`/);

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
