import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Report } from "@pharn-ci/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-50 (binary-diff-not-blind). main() and nodeDeps() are loaded inside the test body: the AC test is written before
// TI01 counts a deleted test file that git shows as binary, so nothing the build changes may run while the file loads.
// The repository is a real temporary git repository. Its base commit holds src/cart.ts and src/cart.test.ts with tests;
// its head commit adds `.gitattributes` with `*.test.ts -diff` and deletes src/cart.test.ts, so git prints
// `Binary files a/src/cart.test.ts and /dev/null differ` for it. The test asserts that line first.

const TEST_PATH = "src/cart.test.ts";
const DELETED = "Test file deleted; git shows it as binary, so its text was not read.";

const TEST_TEXT = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
  "",
].join("\n");

let dir: string;
let baseId: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-core50-binary-")));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/cart.ts"), "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n");
  writeFileSync(join(dir, TEST_PATH), TEST_TEXT);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  baseId = git("rev-parse", "HEAD").trim();
  git("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, ".gitattributes"), "*.test.ts -diff\n");
  rmSync(join(dir, TEST_PATH));
  git("add", "-A");
  git("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/cart.ts\nDA:1,1\nend_of_record\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("pharn-ci check: a test file deleted under a `-diff` attribute is not hidden", () => {
  it("AC-15: the built CLI on a temporary repository whose head adds `*.test.ts -diff` and deletes src/cart.test.ts exits 1 with the TI01 block in block, and exits 0 with a TI01 warn in warn", async () => {
    expect(
      git("diff", "--no-color", `${baseId}...HEAD`).split("\n"),
      "git shows the deleted test file as binary",
    ).toContain(`Binary files a/${TEST_PATH} and /dev/null differ`);

    const { main } = await import("../src/main.js");
    const { nodeDeps } = await import("../src/nodeDeps.js");
    const runMode = async (mode: "block" | "warn") => {
      const deps = nodeDeps(dir);
      let out = "";
      deps.stdout = (text) => {
        out += text;
      };
      deps.stderr = () => {};
      const code = await main(
        ["check", "--format", "json", "--test-integrity", mode, "--base", baseId, "--coverage", "coverage/lcov.info"],
        deps,
      );
      const report = JSON.parse(out) as Report;
      expectValidReport(report);
      return { code, ti01: report.testIntegrity.signals.filter((s) => s.id === "TI01") };
    };

    const block = await runMode("block");
    expect(block.ti01, "the TI01 block of AC-1").toEqual([
      expect.objectContaining({ severity: "block", path: TEST_PATH, line: null, detail: DELETED }),
    ]);
    expect(block.code, "block exits 1").toBe(1);

    const warn = await runMode("warn");
    expect(warn.ti01, "the TI01 warn").toEqual([
      expect.objectContaining({ severity: "warn", path: TEST_PATH, line: null, detail: DELETED }),
    ]);
    expect(warn.code, "warn exits 0").toBe(0);
  }, 60_000);
});
