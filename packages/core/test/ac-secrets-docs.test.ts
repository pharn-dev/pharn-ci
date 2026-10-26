import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Reads the repository files and the base commit with git. findSecretSpans() is loaded inside the test body: the AC
// test is written before the redaction module exists, so nothing the build adds may run while the file loads.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** The commit this increment starts from. */
const BASE = "392907565188de7b67f713137d7f7531114f5a36";

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const readBytes = (path: string) => readFileSync(join(ROOT, path));
const atBase = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT }) as Buffer;

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
  "packages/core/test/ac-secrets-repin.test.ts",
];

/** The section of a markdown text from the heading matching `heading` to the next heading of the same or a higher level. */
function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  expect(start, `a heading matching ${heading}`).toBeGreaterThan(-1);
  const level = (/^#+/.exec(lines[start] as string)?.[0] ?? "#").length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const m = /^(#+) /.exec(line);
    return m !== null && (m[1] as string).length <= level;
  });
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

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

describe("A7 docs, schema and fixtures", () => {
  it("AC-22: the schema, README, LIMITS, THREAT-MODEL and CHANGELOG document A7, report.v1.json is unchanged, and no committed fixture or test holds a secret", async () => {
    const { findSecretSpans } = (await import("../src/index.js")) as unknown as {
      findSecretSpans(text: string): { id: string; start: number; end: number }[];
    };

    // schema/report.v2.json names the 12 codes after "Codes added in v0.4.0:"; report.v1.json is as at the base.
    const description = messageCodeDescription(read("schema/report.v2.json"));
    const added = description.indexOf("Codes added in v0.4.0:");
    expect(added, "the description holds Codes added in v0.4.0:").toBeGreaterThan(-1);
    for (const code of CODES) expect(description.slice(added), `the v0.4.0 text names ${code}`).toContain(code);
    expect(
      readBytes("schema/report.v1.json").equals(atBase("schema/report.v1.json")),
      "report.v1.json is unchanged",
    ).toBe(true);

    // README: the 12 codes in the message-code table, a Secrets in agent configs section, and the inventory bullet.
    const readme = read("README.md");
    const tableRows = readme.split("\n").filter((line) => line.startsWith("|"));
    for (const code of CODES) {
      expect(
        tableRows.some((row) => row.includes(`\`${code}\``)),
        `README message-code table row for ${code}`,
      ).toBe(true);
    }
    section(readme, /^#+ Secrets in agent configs\s*$/);
    const bullets = readme.split(/\n(?=- )/);
    expect(
      bullets.some((b) => /inventory/i.test(b) && b.includes("A7") && /machine-readable/i.test(b)),
      "an inventory bullet saying A7 reads the machine-readable kinds",
    ).toBe(true);

    // docs/LIMITS.md: a Secrets in agent configs section naming the misses, and no "never reads" sentence left.
    const limits = read("docs/LIMITS.md");
    const misses = section(limits, /^#+ Secrets in agent configs\s*$/);
    const named: Array<[string, RegExp]> = [
      ["Markdown kinds", /Markdown/],
      [".env files", /\.env/],
      [".continue/config.*", /\.continue\/config\./],
      ["custom formats", /custom format/i],
      ["base64-wrapped values", /base64/i],
      ["split values", /split/i],
      ["nested copies of root-only kinds", /nested/i],
      ["low-entropy passwords", /low-entropy/i],
      ["keys in file names", /file names?/i],
      ["no provider verification", /provider/i],
      ["an embedding with no batch git runner scans nothing", /batch git runner/i],
    ];
    for (const [label, pattern] of named) expect(misses, `LIMITS names ${label}`).toMatch(pattern);
    expect(limits, "LIMITS no longer says the inventory never reads setup files").not.toContain(
      "lists agent setup files and never reads them",
    );
    expect(limits, "LIMITS no longer says pharn-ci never reads file contents").not.toContain(
      "pharn-ci never reads file contents",
    );

    // docs/THREAT-MODEL.md: agent config text in row A1, and a row for the blob read.
    const rows = read("docs/THREAT-MODEL.md")
      .split("\n")
      .filter((line) => /^\| [A-Z]\d+ /.test(line));
    const a1 = rows.find((row) => row.startsWith("| A1 "));
    expect(a1, "row A1").toBeDefined();
    expect(a1, "row A1 lists agent config text").toMatch(/agent config/i);
    expect(
      rows.some((row) => !row.startsWith("| A1 ") && /agent config/i.test(row) && row.includes("cat-file")),
      "a row for the agent config blob read",
    ).toBe(true);

    // CHANGELOG: the Unreleased section mentions A7.
    const changelog = read("CHANGELOG.md");
    const unreleased = changelog.slice(
      changelog.indexOf("## [Unreleased]"),
      changelog.indexOf("\n## [", changelog.indexOf("## [Unreleased]") + 1),
    );
    expect(unreleased, "CHANGELOG Unreleased mentions A7").toContain("A7");

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
