import { describe, expect, it } from "vitest";
import { measureGrowth } from "./growth.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 reads the native [tool.pytest] table, so
// nothing the build adds may run while the file loads. Every text is generated here. A native table that cannot be
// read is refused as the [tool.pytest.ini_options] table is today: no TI09 and a TEST_INTEGRITY_INDEX_UNAVAILABLE
// message naming pyproject.toml with its reason. Each hostile size is run once to warm up, then measured on this
// thread's CPU time with measureGrowth (growth.ts).

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "pyproject.toml";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const CAP = 524288;

interface Report {
  testIntegrity: { signals: { id: string; path: string }[] };
  messages: { code: string; level: string; text: string }[];
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${PATH} b/${PATH}`, "index 1111111..2222222 100644", `--- a/${PATH}`, `+++ b/${PATH}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** The check() input for one base and head text, diff included, built before any timing. */
function inputOf(base: string, head: string) {
  return {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [PATH, "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
  };
}

async function run(base: string, head: string): Promise<{ report: Report }> {
  const { check } = await import("../src/check.js");
  const report = check(inputOf(base, head) as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return { report: report as unknown as Report };
}

const BASE = '[project]\nname = "demo"\n\n[tool.pytest]\naddopts = ["-ra"]\ntestpaths = ["tests"]\n';

/** Each unreadable native table: its head text and the reason it must be named with. */
const UNREADABLE: { label: string; head: string; reason: string }[] = [
  {
    label: "a native table over 524288 UTF-16 code units",
    head: `[project]\nname = "demo"\n\n[tool.pytest]\naddopts = ["-ra", "-k", "not slow"]\ntestpaths = ["tests"]\n${"# padding\n".repeat(CAP / 10 + 1)}`,
    reason: "too-large",
  },
  {
    label: "a native table line that is not key = value",
    head: '[project]\nname = "demo"\n\n[tool.pytest]\naddopts = ["-ra", "-k", "not slow"]\nthis line is no key\ntestpaths = ["tests"]\n',
    reason: "invalid-toml",
  },
  {
    label: "a native array left unclosed before the next header",
    head: '[project]\nname = "demo"\n\n[tool.pytest]\naddopts = ["-ra"]\ntestpaths = [\n  "tests/unit",\n\n[tool.other]\nx = 1\n',
    reason: "invalid-toml",
  },
];

/** A hostile native table of about `size` code units: look-alike headers, unbalanced quotes, an array left open. */
function hostile(size: number): string {
  const lines = ["[tool.pytest]", 'addopts = "-ra"'];
  let length = lines.join("\n").length;
  const shapes = ["[tool.pytest", "[tool.pytestx", "[[tool.pytest", 'a = "', "b = '", 'c = """', "d = ["];
  for (let n = 0; length < size * 0.6; n++) {
    const line = shapes[n % shapes.length] as string;
    lines.push(line);
    length += line.length + 1;
  }
  lines.push("testpaths = [");
  length += 14;
  while (length < size - 16) {
    lines.push('  "a",');
    length += 7;
  }
  return `${lines.join("\n")}\n`;
}

describe("TI09 refuses a native [tool.pytest] table it cannot read, in linear time", () => {
  it("AC-16: a native table over the cap, with a non key = value line, or with an unclosed array gives no TI09 and a TEST_INTEGRITY_INDEX_UNAVAILABLE naming pyproject.toml with too-large, invalid-toml and invalid-toml; a hostile native table just under the cap reads in less than 8 times a quarter-size one", async () => {
    expect((UNREADABLE[0] as { head: string }).head.length, "over the cap").toBeGreaterThan(CAP);
    for (const { label, head, reason } of UNREADABLE) {
      const { report } = await run(BASE, head);
      expect(
        report.testIntegrity.signals.filter((s) => String(s.id) === "TI09" && s.path === PATH),
        `${label}: no TI09 for ${PATH}`,
      ).toEqual([]);
      const messages = report.messages.filter((m) => String(m.code) === CODE);
      expect(messages, `${label}: one ${CODE} message`).toHaveLength(1);
      expect(messages[0]?.text, `${label}: names ${PATH}`).toContain(PATH);
      expect(messages[0]?.text, `${label}: names ${reason}`).toContain(reason);
    }

    const full = hostile(CAP - 64);
    const quarter = hostile(Math.floor(CAP / 4));
    expect(full.length, "the hostile text is under the cap").toBeLessThan(CAP);
    expect(full.length, "the hostile text is near the cap").toBeGreaterThan(CAP - 1024);
    expect(
      full.split("\n").filter((l) => l.startsWith("[tool.pytest")).length,
      "thousands of look-alikes",
    ).toBeGreaterThan(5000);
    const { check } = await import("../src/check.js");
    type Input = Parameters<typeof check>[0];
    const fullInput = inputOf(BASE, full) as unknown as Input;
    const quarterInput = inputOf(BASE, quarter) as unknown as Input;
    for (const input of [fullInput, quarterInput]) expectValidReport(check(input));
    const growth = await measureGrowth(
      () => check(quarterInput),
      () => check(fullInput),
    );
    expect(growth.ratio, `full vs quarter: ${growth.detail}`).toBeLessThan(8);
  }, 300_000);
});
