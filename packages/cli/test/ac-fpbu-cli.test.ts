import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Report } from "@pharn-ci/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-348 (file-policy-base-union), AC-14. main() and nodeDeps() are loaded inside the test body: the AC test is
// written before the CLI reads the --policy-file's base copy ahead of applyPolicy, so nothing the build adds may run
// while this file loads. A real temporary git repository: `main` holds a policy raising TI06 to block (mode block);
// the `feature` branch lowers TI06 to warn and loosens one toBe(5) to toBeTruthy(), which TI06 reports at warn.

const POLICY_PATH = "policy/org.json";
const SOURCE = "src/cart.ts";
const TEST = "src/cart.test.ts";
const SOURCE_BASE = "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n";
const SOURCE_HEAD = "export const total = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0);\n";
const testFile = (assertion: string) =>
  [
    'import { describe, expect, it } from "vitest";',
    'import { total } from "./cart.js";',
    "",
    'describe("cart", () => {',
    '  it("adds the prices", () => {',
    `    expect(total([2, 3])).${assertion};`,
    "  });",
    "",
    '  it("totals an empty cart", () => {',
    "    expect(total([])).toBe(0);",
    "  });",
    "});",
    "",
  ].join("\n");
const policy = (ti06: "block" | "warn") =>
  `${JSON.stringify({ version: 1, test_integrity: { mode: "block", signals: { TI06: ti06 } } }, null, 2)}\n`;

let dir: string;

function put(path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-fpbu-cli-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put(SOURCE, SOURCE_BASE);
  put(TEST, testFile("toBe(5)"));
  put(POLICY_PATH, policy("block"));
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  put(SOURCE, SOURCE_HEAD);
  put(TEST, testFile("toBeTruthy()"));
  put(POLICY_PATH, policy("warn"));
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  put("coverage/lcov.info", `SF:${dir}/${SOURCE}\nDA:1,1\nend_of_record\n`);
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The settings POLICY_OVERRIDE_IGNORED names, without the numbers a threshold carries. */
function ignoredNames(report: Report): string[] {
  return report.messages
    .filter((m) => m.code === "POLICY_OVERRIDE_IGNORED")
    .flatMap((m) => {
      const at = m.text.indexOf("applies: ");
      expect(at, "the message lists the settings after 'applies: '").toBeGreaterThan(-1);
      return m.text
        .slice(at + "applies: ".length)
        .replace(/\.$/, "")
        .split(", ")
        .map((entry) => entry.split(" ")[0] ?? "");
    });
}

describe("pharn-ci check --policy-file: the base copy's raised signal holds", { timeout: 60_000 }, () => {
  it("AC-14: main raises TI06 to block, the branch lowers it to warn and triggers it: TI06's message is an error and POLICY_OVERRIDE_IGNORED names test_integrity.signals.TI06", async () => {
    const { main } = await import("../src/main.js");
    const { nodeDeps } = await import("../src/nodeDeps.js");
    const deps = nodeDeps(dir);
    let out = "";
    let err = "";
    deps.stdout = (text) => {
      out += text;
    };
    deps.stderr = (text) => {
      err += text;
    };
    const code = await main(
      ["check", "--base", "main", "--coverage", "coverage/lcov.info", "--format", "json", "--policy-file", POLICY_PATH],
      deps,
    );
    expect(code, err).not.toBe(2);
    const report = JSON.parse(out) as Report;
    expectValidReport(report);

    const ti06 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
    expect(
      ti06.map((s) => s.path),
      "control: the branch triggers TI06 in the test file",
    ).toEqual([TEST]);
    const messages = report.messages.filter((m) => m.code === "TEST_INTEGRITY_TI06");
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.map((m) => m.level)).toEqual(messages.map(() => "error"));
    expect(ignoredNames(report)).toContain("test_integrity.signals.TI06");
  });
});
