import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), withAcceptLabel() and the renderer are loaded inside the test body: the AC test is written before TI09 and
// its hint exist, so nothing that depends on them may run while the file loads. The report comes from check() over
// sources written here: a lowered threshold (block, with a line), a raised retry (warn, with a line) in
// vitest.config.ts and an added passWithNoTests (block, line null) in package.json.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const DEFAULT_LABEL = "pharn/accepted";
const CUSTOM_LABEL = "qa-approved";
const FINDING = /^- \S+ \*\*(TI\d\d)\*\* `([^`]+)`/;

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
}
interface Pair {
  path: string;
  base: string;
  head: string;
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf({ path, base, head }: Pair): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

const vitest = (lines: number, retry: number) =>
  `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    retry: ${retry},\n    coverage: { thresholds: { lines: ${lines} } },\n  },\n});\n`;
const pkg = (jest: unknown) => `${JSON.stringify({ name: "demo", jest }, null, 2)}\n`;

const PAIRS: Pair[] = [
  {
    path: "package.json",
    base: pkg({ testEnvironment: "node" }),
    head: pkg({ testEnvironment: "node", passWithNoTests: true }),
  },
  { path: "vitest.config.ts", base: vitest(90, 0), head: vitest(70, 2) },
];

async function buildReport(): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const side = (key: "base" | "head") => PAIRS.map((p) => ({ path: p.path, text: p[key] }));
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: PAIRS.map(diffOf).join("") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...PAIRS.map((p) => p.path), "src/cart.ts"].sort(),
    testIntegrityMode: { input: "block" },
    testSources: { base: { files: side("base"), dropped: [] }, head: { files: side("head"), dropped: [] } },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

/** The non-empty lines of the Messages section: from its heading to the next heading. */
function messageLines(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("### 💬 Messages ("));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("#"));
  return lines.slice(start + 1, end === -1 ? lines.length : end).filter((line) => line.trim() !== "");
}

describe("renderMarkdown(): TI09 in the Test integrity section", () => {
  it("AC-17: each TI09 finding is listed with its id in bold, path:line or path in a code span and its detail, a hint naming the accept label in use and the warn-only retry and timeout sits under each, and the TEST_INTEGRITY_TI09 message is left out of the Messages section", async () => {
    const report = await buildReport();
    const signals = report.testIntegrity.signals.filter((s) => String(s.id) === "TI09");
    expect(
      signals.some((s) => s.severity === "block"),
      "a block TI09",
    ).toBe(true);
    expect(
      signals.some((s) => s.severity === "warn"),
      "a warn TI09",
    ).toBe(true);
    expect(
      signals.some((s) => s.line !== null),
      "a TI09 with a line",
    ).toBe(true);
    expect(
      signals.some((s) => s.line === null),
      "a TI09 with line null",
    ).toBe(true);
    expect(
      report.messages.some((m) => String(m.code) === "TEST_INTEGRITY_TI09"),
      "the report holds the TEST_INTEGRITY_TI09 message",
    ).toBe(true);

    const { renderMarkdown, withAcceptLabel } = await import("@pharn-ci/core");
    const labelled = withAcceptLabel(report as never, CUSTOM_LABEL);
    expectValidReport(labelled);

    for (const [label, input] of [
      [DEFAULT_LABEL, report],
      [CUSTOM_LABEL, labelled],
    ] as const) {
      const markdown = renderMarkdown(input as never);
      const lines = section(markdown);
      for (const signal of signals) {
        const where = signal.line === null ? signal.path : `${signal.path}:${signal.line}`;
        const at = lines.findIndex((line) => FINDING.exec(line)?.slice(1, 3).join(" ") === `TI09 ${where}`);
        expect(at, `${label}: the finding for ${where} is listed`).toBeGreaterThan(-1);
        expect(lines[at]?.replace(/\\(.)/g, "$1"), `${label}: the finding line holds the detail`).toContain(
          signal.detail,
        );
        const hint = lines[at + 1] ?? "";
        expect(hint.startsWith("  - Hint: "), `${label}: a hint under ${where}`).toBe(true);
        expect(hint, `${label}: the hint names the accept label in use`).toContain(`\`${label}\``);
        expect(hint, `${label}: the hint says a raised retry is a warning only`).toMatch(/retr/i);
        expect(hint, `${label}: the hint says a raised timeout is a warning only`).toMatch(/timeout/i);
        expect(hint, `${label}: the hint says warning only`).toMatch(/warning only/i);
      }
      for (const line of messageLines(markdown)) {
        expect(line, `${label}: the Messages section does not list TEST_INTEGRITY_TI09`).not.toContain(
          "`TEST_INTEGRITY_TI09`",
        );
      }
    }
  });
});
