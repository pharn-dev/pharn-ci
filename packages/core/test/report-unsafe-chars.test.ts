import { describe, expect, it } from "vitest";
import { validateAcceptLabel } from "../src/acceptLabel.js";
import { check } from "../src/check.js";
import { shownPattern } from "../src/policy/rules/shown.js";
import { codeSpan, oneLine } from "../src/report.js";
import { removedTestDetail, summaryTestName } from "../src/signals/testName.js";
import { cutDetail, cutValue, keyText } from "../src/testConfig/value.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// report.json used to drop only the control characters; it now also drops the invisible and bidirectional characters
// the PR comment drops (text.ts). Each site keeps its own replacement: a space for one-line text and test names, U+FFFD
// for code spans and test-config values, one code unit for one, so the cut lengths stay as they were.

const REPO_ROOT = "/home/runner/work/demo/demo";

/** The code points the comment stripped and report.json kept before this change. */
const ADDED = [
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  0xfeff,
];
const INVISIBLE = String.fromCharCode(...ADDED);
const SPACES = " ".repeat(ADDED.length);
const REPLACEMENTS = "�".repeat(ADDED.length);

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

function expectNoAdded(report: unknown, label: string) {
  const json = JSON.stringify(report);
  for (const code of ADDED) {
    const char = String.fromCharCode(code);
    expect(json.includes(char), `${label}: U+${code.toString(16)} is not in the report`).toBe(false);
  }
}

const TEST_PATH = "src/cart.test.ts";
const testFile = (names: string[]) =>
  [
    'import { expect, it } from "vitest";',
    "",
    ...names.flatMap((name, i) => [`it(${JSON.stringify(name)}, () => {`, `  expect(${i + 1}).toBe(${i + 1});`, "});"]),
    "",
  ].join("\n");

/** check() on a change that removes the test `name` from a test file, in mode block. */
function removedTestReport(name: string) {
  const base = testFile(["keeps the cart", name]);
  const head = testFile(["keeps the cart"]);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(TEST_PATH, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", TEST_PATH],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: TEST_PATH, text: base }], dropped: [] },
      head: { files: [{ path: TEST_PATH, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const CONFIG_PATH = "vitest.config.ts";
const config = (include: string) =>
  [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    `    include: [${JSON.stringify(include)}],`,
    "  },",
    "});",
    "",
  ].join("\n");

/** check() on a change that sets the vitest include entry to `include`, in mode block. */
function configReport(include: string) {
  const base = config("src/**/*.test.ts");
  const head = config(include);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(CONFIG_PATH, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", CONFIG_PATH],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: CONFIG_PATH, text: base }], dropped: [] },
      head: { files: [{ path: CONFIG_PATH, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

/** check() on a change to a test file whose base text could not be read for `reason`, in mode block. */
function unreadableReport(reason: string) {
  const text = testFile(["keeps the cart"]);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(TEST_PATH, text, testFile(["keeps the cart", "adds"])) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", TEST_PATH],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { unavailable: reason },
      head: { files: [{ path: TEST_PATH, text }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

/** check() on a coverage file whose only path, `path`, is not a tracked file. */
function unmatchedReport(path: string) {
  const report = check({
    version: "0.1.0",
    coverage: { text: `TN:\nSF:${path}\nDA:1,1\nend_of_record\n`, format: "lcov" },
    diff: { text: diffOf("src/cart.ts", "a\n", "b\n") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts"],
  });
  expectValidReport(report);
  return report;
}

describe("report.json drops the invisible and bidirectional characters the comment drops", () => {
  it("a message: one-line text (git stderr) and a code span carry none of them, and plain text is unchanged", () => {
    const unread = unreadableReport(`git show failed${INVISIBLE}for base`);
    expectNoAdded(unread, "unreadable test sources");
    const unreadMessage = unread.messages.find((m) => m.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE");
    expect(unreadMessage?.text).toContain("(`git show failed for base`)");
    // Control: the same reason without them gives the same text.
    const plainUnread = unreadableReport("git show failed for base");
    expect(plainUnread.messages.find((m) => m.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE")?.text).toBe(
      unreadMessage?.text,
    );

    const unmatched = unmatchedReport(`lib/a${INVISIBLE}b.ts`);
    expectNoAdded(unmatched, "unmatched coverage path");
    const unmatchedMessage = unmatched.messages.find((m) => m.code === "COVERAGE_PATHS_UNMATCHED");
    expect(unmatchedMessage?.text).toContain(`(for example \`lib/a${REPLACEMENTS}b.ts\`)`);
    // Control: a plain path is quoted as given.
    const plain = unmatchedReport("lib/ab.ts").messages.find((m) => m.code === "COVERAGE_PATHS_UNMATCHED");
    expect(plain?.text).toContain("(for example `lib/ab.ts`)");
    expect(plain?.text.replace("lib/ab.ts", `lib/a${REPLACEMENTS}b.ts`)).toBe(unmatchedMessage?.text);
  });

  it("a signal detail and a tests-changed name carry none of them, each replaced by a space", () => {
    const report = removedTestReport(`drops${INVISIBLE}the item`);
    expectNoAdded(report, "removed test");
    const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02");
    expect(ti02.map((s) => s.detail)).toEqual([
      `The test "drops${SPACES}the item" at line 6 of the base is gone at head, and no test with the same name or a similar body takes its place.`,
    ]);
    const removed = (report.testIntegrity as unknown as { changes: { removed: { name: string }[] } }).changes.removed;
    expect(removed.map((entry) => entry.name)).toEqual([`drops${SPACES}the item`]);

    // Control: a name that already had the spaces gives the same report, byte for byte.
    expect(JSON.stringify(removedTestReport(`drops${SPACES}the item`))).toBe(JSON.stringify(report));
  });

  it("a test-config value carries none of them, each replaced by U+FFFD", () => {
    const report = configReport(`src/${INVISIBLE}/**/*.test.ts`);
    expectNoAdded(report, "test-config value");
    const ti09 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI09") as unknown as {
      detail: string;
      head?: string;
    }[];
    expect(ti09).toHaveLength(1);
    expect(JSON.stringify(ti09[0])).toContain(`src/${REPLACEMENTS}/**/*.test.ts`);

    // Re-pinned for H4 (prompt-injection scan, PI01): the added line of vitest.config.ts now also carries a PI01
    // finding for the invisible characters (an INJECTION_PI01 message and the injection object), which the U+FFFD
    // control has not. The finding names the first character and a count, never the value; with it taken out the two
    // reports are still equal byte for byte.
    expect(report.injection?.signals).toEqual([
      {
        id: "PI01",
        severity: "block",
        path: "vitest.config.ts",
        line: 5,
        detail: "zero-width space U+200B and 14 more",
      },
    ]);
    const withoutPi01 = (r: typeof report) => ({
      ...r,
      messages: r.messages.filter((m) => m.code !== "INJECTION_PI01"),
      injection: undefined,
    });
    const control = configReport(`src/${REPLACEMENTS}/**/*.test.ts`);
    expect(control.injection).toBeUndefined();

    // Control: a value that already had U+FFFD there gives the same report, byte for byte (the PI01 finding aside).
    expect(JSON.stringify(control)).toBe(JSON.stringify(withoutPi01(report)));
  });

  it("each site replaces one code unit for one, so the cuts fall where they did", () => {
    const long = (fill: string) => `${"a".repeat(100)}${fill}${"b".repeat(300)}`;
    expect(removedTestDetail(long(INVISIBLE), 3)).toBe(removedTestDetail(long(SPACES), 3));
    expect(removedTestDetail(long(INVISIBLE), 3).length).toBeLessThanOrEqual(300);
    expect(summaryTestName(long(INVISIBLE))).toBe(summaryTestName(long(SPACES)));
    const value = (fill: string) => `${"v".repeat(70)}${fill}`;
    expect(cutValue(value(INVISIBLE))).toBe(cutValue(value(REPLACEMENTS)));
    expect(cutValue(value(INVISIBLE))).toBe(`${"v".repeat(70)}${"�".repeat(9)}…`);
    expect(cutDetail(long(INVISIBLE))).toBe(cutDetail(long(REPLACEMENTS)));
    expect(keyText(["test", `in${INVISIBLE}clude`])).toBe(keyText(["test", `in${REPLACEMENTS}clude`]));
    expect(codeSpan(`a${INVISIBLE}b`)).toBe(`\`a${REPLACEMENTS}b\``);
    expect(oneLine(`a${INVISIBLE}b`)).toBe("a b");

    // Control: text with none of them, control characters handled as before, other scripts and emoji kept.
    const plain = "naïve 😀 日本語   ‐ test";
    expect(removedTestDetail(plain, 3)).toContain(`"${plain}"`);
    expect(summaryTestName(plain)).toBe(plain);
    expect(summaryTestName("a\tb c")).toBe("a b c");
    expect(cutValue("a\tb")).toBe("a�b");
    expect(cutValue("plain value 😀")).toBe("plain value 😀");
    expect(codeSpan(plain)).toBe(`\`${plain}\``);
    expect(oneLine("a\n\tb  c")).toBe("a b c");
  });
});

/** check() with only coverage and diff varied; everything else plain. */
function coverageReport(coverage: unknown, diff: unknown = { text: diffOf("src/cart.ts", "a\n", "b\n") }) {
  const report = check({
    version: "0.1.0",
    coverage,
    diff,
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts"],
  } as never);
  expectValidReport(report);
  return report;
}

const textOf = (report: { messages: { code: string; text: string }[] }, code: string) =>
  report.messages.find((m) => m.code === code)?.text;

const SETTINGS = ".claude/settings.json";
/** check() under a policy file that requires the deny rule `rule`, with settings sources as given. */
function policyReport(rule: string, sources: unknown) {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", SETTINGS],
    policy: {
      source: "file",
      version: null,
      path: "policy/org.json",
      document: { version: 1, setup: { required_permissions_deny: [rule] } },
    },
    policySettingsSources: sources,
  } as never);
  expectValidReport(report);
  return report;
}

/** check() under an app policy with two instruction files in `dir` that name different package managers. */
function p07Report(dir: string) {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", `${dir}/AGENTS.md`, `${dir}/CLAUDE.md`, "src/a.ts"],
    policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } },
    agentInstructionSources: {
      files: [
        { path: `${dir}/AGENTS.md`, text: "# Agents\n\nRun `pnpm install`, then `pnpm test`.\n" },
        { path: `${dir}/CLAUDE.md`, text: "# Claude\n\n```sh\nnpm install\nnpm test\n```\n" },
      ],
      dropped: [],
    },
  } as never);
  expectValidReport(report);
  return report;
}

describe("the other message and detail sites drop them too", () => {
  it("DIFF_UNAVAILABLE: the detail (a base ref, git text) carries none of them, each a space; a plain detail is unchanged", () => {
    const report = coverageReport(
      { text: fixture("golden/coverage.info"), format: "lcov" },
      { unavailable: `could not get the diff for ma${INVISIBLE}in...abc (use actions/checkout with fetch-depth: 0)` },
    );
    expectNoAdded(report, "diff unavailable");
    expect(textOf(report, "DIFF_UNAVAILABLE")).toBe(
      `Diff coverage was not computed: could not get the diff for ma${SPACES}in...abc (use actions/checkout with fetch-depth: 0)`,
    );
    // Control: a plain detail longer than 200 characters is kept whole and byte-identical (no cut, unlike oneLine).
    const plain = `could not get the diff for ${"b".repeat(220)}...abc (use actions/checkout with fetch-depth: 0)`;
    const plainReport = coverageReport(
      { text: fixture("golden/coverage.info"), format: "lcov" },
      { unavailable: plain },
    );
    expect(textOf(plainReport, "DIFF_UNAVAILABLE")).toBe(`Diff coverage was not computed: ${plain}`);
  });

  it("COVERAGE_FILE_MISSING, COVERAGE_FILE_EMPTY and COVERAGE_FORMAT_UNSUPPORTED: the path carries none of them, each U+FFFD; a plain path is unchanged", () => {
    const odd = `cov/lc${INVISIBLE}ov.info`;
    const shown = `cov/lc${REPLACEMENTS}ov.info`;
    const cases: [code: string, coverage: (path: string) => unknown, text: (path: string) => string][] = [
      ["COVERAGE_FILE_MISSING", (path) => ({ missingFile: path }), (path) => `Coverage file not found: ${path}`],
      [
        "COVERAGE_FILE_EMPTY",
        (path) => ({ text: "", format: "auto", file: path }),
        (path) => `Coverage file ${path} contains no coverage records; check its format and that the tests wrote it.`,
      ],
      [
        "COVERAGE_FORMAT_UNSUPPORTED",
        (path) => ({ text: "not a coverage report\n", format: "auto", file: path }),
        (path) =>
          `Coverage file ${path} is not in a recognized coverage format; pharn-ci reads lcov and Cobertura XML.`,
      ],
    ];
    for (const [code, coverage, text] of cases) {
      const report = coverageReport(coverage(odd));
      expectNoAdded(report, code);
      expect(textOf(report, code), code).toBe(text(shown));
      // Control: a plain path is named as it is.
      expect(textOf(coverageReport(coverage("coverage/lcov.info")), code), `${code} plain`).toBe(
        text("coverage/lcov.info"),
      );
    }
  });

  it("POLICY_SETTINGS_INVALID: the reason the settings files were not read (git text) carries none of them, each a space", () => {
    const report = policyReport("Bash(rm:*)", { unavailable: `git cat-file failed${INVISIBLE}here` });
    expectNoAdded(report, "settings unavailable");
    expect(textOf(report, "POLICY_SETTINGS_INVALID")).toBe(
      `The agent settings files were not read (git cat-file failed${SPACES}here), so P02–P06 did not run.`,
    );
    // Control: a plain reason is named as it is.
    expect(
      textOf(policyReport("Bash(rm:*)", { unavailable: "git cat-file failed here" }), "POLICY_SETTINGS_INVALID"),
    ).toBe("The agent settings files were not read (git cat-file failed here), so P02–P06 did not run.");
  });

  it("a policy violation detail: a pattern from the policy and a tracked path carry none of them, each U+FFFD", () => {
    const sources = { files: [{ path: SETTINGS, text: '{ "permissions": {} }\n' }], dropped: [] };
    const report = policyReport(`Bash(rm${INVISIBLE}:*)`, sources);
    expectNoAdded(report, "required deny rule");
    const p03 = (report.policy?.violations ?? []).filter((v) => String(v.id) === "P03").map((v) => v.detail);
    expect(p03).toEqual([`required deny rule Bash(rm${REPLACEMENTS}:*) is missing`]);
    // Control: a plain pattern is shown as it is.
    const plain = policyReport("Bash(rm:*)", sources).policy?.violations.filter((v) => String(v.id) === "P03");
    expect(plain?.map((v) => v.detail)).toEqual(["required deny rule Bash(rm:*) is missing"]);
    // The cut falls where it did: one code unit for one.
    expect(shownPattern(`${"p".repeat(70)}${INVISIBLE}`)).toBe(shownPattern(`${"p".repeat(70)}${REPLACEMENTS}`));
    expect(shownPattern(`${"p".repeat(70)}${INVISIBLE}`)).toBe(`${"p".repeat(70)}${"�".repeat(9)}…`);

    // P07 names the other instruction file by its path; the violation's own path field stays the exact tracked path.
    const dir = `pk${INVISIBLE}g`;
    const details = (p07Report(dir).policy?.violations ?? [])
      .filter((v) => String(v.id) === "P07")
      .map((v) => v.detail);
    expect(details).toEqual([
      `package manager: pnpm here, npm in pk${REPLACEMENTS}g/CLAUDE.md:4`,
      `package manager: npm here, pnpm in pk${REPLACEMENTS}g/AGENTS.md:3`,
    ]);
    const plainDetails = (p07Report("pkg").policy?.violations ?? [])
      .filter((v) => String(v.id) === "P07")
      .map((v) => v.detail);
    expect(plainDetails).toEqual([
      "package manager: pnpm here, npm in pkg/CLAUDE.md:4",
      "package manager: npm here, pnpm in pkg/AGENTS.md:3",
    ]);
  });

  it("the accept label is refused when it holds any character of the set, line and paragraph separators included", () => {
    for (const code of [...ADDED, 0x2028, 0x2029]) {
      const result = validateAcceptLabel(`ship${String.fromCharCode(code)}it`);
      expect(result.ok, `U+${code.toString(16)} is refused`).toBe(false);
    }
    // Control: a plain label, one with other scripts and the default are accepted as they are.
    expect(validateAcceptLabel("ship-it")).toEqual({ ok: true, label: "ship-it" });
    expect(validateAcceptLabel("zatwierdź ✅")).toEqual({ ok: true, label: "zatwierdź ✅" });
    expect(validateAcceptLabel("")).toEqual({ ok: true, label: "pharn/accepted" });
  });
});
