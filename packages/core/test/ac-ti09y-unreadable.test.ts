import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the core helpers are loaded inside the test body: the AC test is written before TI09 and its sentence
// in TEST_INTEGRITY_INDEX_UNAVAILABLE exist, so nothing that depends on them may run while the file loads. The checks
// that must add no TI09 sentence run in the same test as the one that must add it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: Message[];
}
interface SourceFile {
  path: string;
  text: string;
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** A `--unified=0` diff of `path` that changes one line. */
const oneLine = (path: string, line: number, before: string, after: string) =>
  `${[`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`, `@@ -${line} +${line} @@`, `-${before}`, `+${after}`].join("\n")}\n`;

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

async function run(diff: string, testSources: unknown, paths: string[]): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...paths, "src/cart.ts"].sort(),
    testIntegrityMode: { input: "block" },
    testSources,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const ti09 = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI09");
const unavailable = (report: Report) => report.messages.filter((m) => String(m.code) === CODE);

const VITEST =
  'import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    include: ["src/**/*.test.ts"],\n  },\n});\n';
const JEST = "module.exports = {\n  passWithNoTests: false,\n};\n";

/** Each unreadable config: its path, base text, head text, the reason code it is named with. */
const UNREADABLE: { path: string; base: string; head: string; reason: string }[] = [
  {
    path: "package.json",
    base: '{\n  "name": "demo",\n  "jest": { "passWithNoTests": false }\n}\n',
    head: '{\n  "name": "demo",\n  "jest": { "passWithNoTests": true, }\n',
    reason: "invalid-json",
  },
  {
    path: "vitest.config.ts",
    base: VITEST,
    head: 'import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    include: ["src/**/*.fast.test.ts",\n  },\n);\n',
    reason: "syntax-error",
  },
  {
    path: "pyproject.toml",
    base: '[project]\nname = "demo"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
    head: '[project]\nname = "demo"\n\n[tool.pytest.ini_options]\ntestpaths = [\n  "tests/unit",\n',
    reason: "invalid-toml",
  },
  {
    path: "pytest.ini",
    base: "[pytest]\naddopts = -q\n",
    head: '[pytest]\naddopts = -q -k "not slow"\nthis line is no key\n',
    reason: "invalid-ini",
  },
  {
    path: "jest.config.js",
    base: JEST,
    head: `module.exports = {\n  passWithNoTests: true,\n};\n// ${"x".repeat(524288)}\n`,
    reason: "too-large",
  },
];

const PLAYWRIGHT_BASE =
  'import { defineConfig } from "@playwright/test";\n\nexport default defineConfig({\n  forbidOnly: true,\n});\n';
const PLAYWRIGHT_HEAD =
  'import { defineConfig } from "@playwright/test";\n\nexport default defineConfig({\n  forbidOnly: false,\n});\n';

const JS_TEST = "src/a.test.ts";
const JS_BASE = 'import { expect, it } from "vitest";\n\nit("adds", () => {\n  expect(1).toBe(1);\n});\n';
/** The TEST_INTEGRITY_INDEX_UNAVAILABLE text check() gives for this case at the base commit, before TI09. */
const JS_ONLY_TEXT =
  "TI02 and TI05 could not compare these touched test files, so they are not checked for removed tests or emptied assertions: `src/a.test.ts` (`too-large`).";

describe("TI09: touched config files whose text cannot be read", () => {
  it("AC-14: five unreadable configs give no TI09 and are named with their reason codes in the one index-unavailable message, an unavailable side says TI09 did not run, a JS-only drop keeps today's text, and an unlisted package.json is skipped silently", async () => {
    // 1. Five configs whose head text cannot be read, in one diff.
    expect(UNREADABLE.find((u) => u.reason === "too-large")?.head.length).toBeGreaterThan(524288);
    const diff = UNREADABLE.map(({ path, base, head }) =>
      path === "jest.config.js"
        ? oneLine(path, 2, "  passWithNoTests: false,", "  passWithNoTests: true,")
        : diffOf(path, base, head),
    ).join("");
    const files = (side: "base" | "head") => UNREADABLE.map((u) => ({ path: u.path, text: u[side] })).sort(byPath);
    const first = await run(
      diff,
      { base: { files: files("base"), dropped: [] }, head: { files: files("head"), dropped: [] } },
      UNREADABLE.map((u) => u.path),
    );
    expect(ti09(first), "no TI09 signal for an unreadable config").toEqual([]);
    const firstMessages = unavailable(first);
    expect(firstMessages, `one ${CODE} message`).toHaveLength(1);
    expect(firstMessages[0]?.level).toBe("warn");
    for (const { path, reason } of UNREADABLE) {
      expect(firstMessages[0]?.text, `names ${path}`).toContain(path);
      expect(firstMessages[0]?.text, `names ${reason}`).toContain(reason);
    }

    // 2. A modified playwright.config.ts with its head side unavailable.
    const core = (await import("@pharn-ci/core")) as unknown as {
      unavailableTestSources(reason: string): { base: unknown; head: unknown };
    };
    const second = await run(
      diffOf("playwright.config.ts", PLAYWRIGHT_BASE, PLAYWRIGHT_HEAD),
      {
        base: { files: [{ path: "playwright.config.ts", text: PLAYWRIGHT_BASE }], dropped: [] },
        head: core.unavailableTestSources("git cat-file failed").head,
      },
      ["playwright.config.ts"],
    );
    expect(ti09(second), "an unavailable side: no TI09 signal").toEqual([]);
    const secondMessages = unavailable(second);
    expect(secondMessages, `one ${CODE} message`).toHaveLength(1);
    expect(secondMessages[0]?.text, "it says TI09 did not run").toContain("TI09 did not run");

    // 3. Only a modified JS test file unreadable: the message text is the one check() gave before TI09.
    const third = await run(
      oneLine(JS_TEST, 3, 'it("adds", () => {', 'it("adds two", () => {'),
      {
        base: { files: [{ path: JS_TEST, text: JS_BASE }], dropped: [] },
        head: { files: [], dropped: [{ path: JS_TEST, reason: "too-large" }] },
      },
      [JS_TEST],
    );
    const thirdMessages = unavailable(third);
    expect(thirdMessages, `one ${CODE} message`).toHaveLength(1);
    expect(thirdMessages[0]?.text, "the text is unchanged by TI09").toBe(JS_ONLY_TEXT);

    // 4. A modified package.json that the head side lists in neither its files nor its dropped files.
    const pkgBase = '{\n  "name": "demo",\n  "jest": { "passWithNoTests": false }\n}\n';
    const pkgHead = '{\n  "name": "demo",\n  "jest": { "passWithNoTests": true }\n}\n';
    const fourth = await run(
      diffOf("package.json", pkgBase, pkgHead),
      { base: { files: [{ path: "package.json", text: pkgBase }], dropped: [] }, head: { files: [], dropped: [] } },
      ["package.json"],
    );
    expect(ti09(fourth), "an unlisted package.json: no TI09 signal").toEqual([]);
    for (const message of fourth.messages) {
      expect(message.text, `${message.code} does not mention TI09`).not.toContain("TI09");
      expect(message.text, `${message.code} does not mention package.json`).not.toContain("package.json");
    }
  });
});
