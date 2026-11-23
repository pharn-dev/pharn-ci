import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Report } from "@pharn-ci/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-69. main() and nodeDeps() are loaded inside the test body: the AC test is written before the modified test
// files are read first, so nothing the build changes may run while the file loads. The repository is a real temporary
// git repository; its base commit holds 200 `.json` files under tests/__fixtures__/ (a directory that sorts before
// tests/cart.test.ts, and test files by directory), and its head commit deletes them and removes one test from
// tests/cart.test.ts. Read in path order, the 200 deleted files would fill the 200-file read cap at the merge base
// ahead of tests/cart.test.ts.

const TEST_PATH = "tests/cart.test.ts";
const FIXTURE_COUNT = 200;

const BASE = [
  'import { expect, it } from "vitest";',
  'import { total } from "../src/cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
  "",
];
/** BASE with its second test removed. */
const HEAD = BASE.slice(0, 7);

let dir: string;
let baseId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-core69-deleted-cap-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "tests/__fixtures__"), { recursive: true });
  writeFileSync(join(dir, "src/cart.ts"), "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n");
  for (let i = 0; i < FIXTURE_COUNT; i++) {
    writeFileSync(join(dir, `tests/__fixtures__/f${String(i).padStart(3, "0")}.json`), `{ "n": ${i} }\n`);
  }
  writeFileSync(join(dir, TEST_PATH), BASE.join("\n"));
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  rmSync(join(dir, "tests/__fixtures__"), { recursive: true, force: true });
  writeFileSync(join(dir, TEST_PATH), HEAD.join("\n"));
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/cart.ts\nDA:1,1\nend_of_record\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("pharn-ci check: deleted test files cannot push a modified one past the read cap at the merge base", () => {
  it(`AC-7: with ${FIXTURE_COUNT} .json files under tests/__fixtures__/ deleted, the removed test in ${TEST_PATH} is a TI02 block and block exits 1`, async () => {
    const { main } = await import("../src/main.js");
    const { nodeDeps } = await import("../src/nodeDeps.js");
    const deps = nodeDeps(dir);
    let out = "";
    deps.stdout = (text) => {
      out += text;
    };
    deps.stderr = () => {};
    const code = await main(
      ["check", "--format", "json", "--test-integrity", "block", "--base", baseId, "--coverage", "coverage/lcov.info"],
      deps,
    );
    const report = JSON.parse(out) as Report;
    expectValidReport(report);

    expect(
      report.messages.filter((m) => m.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE" && m.text.includes(TEST_PATH)),
      `no ${TEST_PATH} unavailable message`,
    ).toEqual([]);
    expect(
      report.testIntegrity.signals
        .filter((s) => String(s.id) === "TI02" && s.path === TEST_PATH)
        .map((s) => s.severity),
      "a TI02 block for the removed test",
    ).toEqual(["block"]);
    expect(code, "block exits 1").toBe(1);
  }, 60_000);
});
