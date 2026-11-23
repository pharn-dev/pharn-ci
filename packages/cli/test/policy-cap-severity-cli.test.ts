import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Report } from "@pharn-ci/core";
import { afterAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// R1.1 (CORE-35), end to end: `pharn-ci check` exits 1 when a blocking P02 or P09 violation sits behind 50 or more
// decoy settings files whose paths sort first. Before the fix the per-rule cap kept the 50 decoys' warnings, dropped
// the block, and the run exited 0. The decoy trees are built in temporary git repositories from the committed
// fixtures in fixtures/policy-settings/cap-severity/, so this repository holds no decoy `.claude/settings.json` files.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/policy-settings/cap-severity/", import.meta.url));
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const POLICY = read("policy.json");
const REAL_TEXT = read("real-settings.json.txt");
const DECOY_TEXT = read("decoy-settings.json.txt");

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const decoyPaths = (count: number) =>
  Array.from({ length: count }, (_, i) => `.a${String(i).padStart(3, "0")}/.claude/settings.json`);

/** A repository: the base commit holds `base` and the policy, the feature commit adds `feature` and edits src/math.ts. */
function repo(base: Record<string, string>, feature: Record<string, string>): string {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-cap-severity-")));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put("src/math.ts", "export const a = 1;\nexport const b = 2;\n");
  put("policy/org.json", POLICY);
  for (const [path, text] of Object.entries(base)) put(path, text);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  put("src/math.ts", "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  for (const [path, text] of Object.entries(feature)) put(path, text);
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  put("coverage/lcov.info", `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n`);
  return dir;
}

async function runCli(dir: string): Promise<{ code: number; report: Report }> {
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
  const args = ["check", "--base", "main", "--coverage", "coverage/lcov.info", "--format", "json"];
  const code = await main([...args, "--policy-file", "policy/org.json"], deps);
  expect(code, err).not.toBe(2);
  const report = JSON.parse(out) as Report;
  expectValidReport(report);
  return { code, report };
}

const level = (report: Report, code: string) => report.messages.filter((m) => m.code === code).map((m) => m.level);
const blocks = (report: Report, id: string) =>
  (report.policy?.violations ?? []).filter((v) => v.id === id && v.severity === "block").map((v) => v.path);

describe("pharn-ci check: the policy cap keeps the blocking violation", () => {
  it("P02: the forbidden allow rule behind 50 and 51 decoy settings files exits 1", async () => {
    for (const count of [50, 51]) {
      const decoys = Object.fromEntries(decoyPaths(count).map((path) => [path, DECOY_TEXT]));
      const dir = repo({ ".claude/settings.json": REAL_TEXT, ...decoys }, {});
      const { code, report } = await runCli(dir);
      expect(code, `${count} decoys`).toBe(1);
      expect(level(report, "POLICY_P02"), `${count} decoys`).toEqual(["error"]);
      expect(blocks(report, "P02"), `${count} decoys`).toEqual([".claude/settings.json"]);
    }
  }, 120_000);

  it("P09: an edit of the file: policy, next to 50 added decoy settings files, exits 1", async () => {
    const decoys = Object.fromEntries(decoyPaths(50).map((path) => [path, DECOY_TEXT]));
    const tighter = `${JSON.stringify({ version: 1, setup: { forbidden_permissions: ["Bash(curl:*)", "Bash(wget:*)"] } })}\n`;
    const dir = repo({}, { ...decoys, "policy/org.json": tighter });
    const { code, report } = await runCli(dir);
    expect(code).toBe(1);
    expect(level(report, "POLICY_P09")).toEqual(["error"]);
    expect(blocks(report, "P09")).toEqual(["policy/org.json"]);
  }, 120_000);
});
