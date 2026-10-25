import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// main() and the core functions are loaded inside the test body, and the fixtures under fixtures/accept-label/ are read
// there too: the AC tests are written before the accept label exists, so nothing the build adds may run while the
// file loads. The CLI has no pull request and no labels, so it never honours the label and has no flag for it.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";
const CHECK = ["check", "--coverage", "coverage/lcov.info", "--test-integrity", "block", "--format", "json"];

function fakeRepo(diff: string, files: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map([[resolve(REPO_ROOT, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const deps = {
    cwd: REPO_ROOT,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) return args.includes("-z") ? `${files.join("\0")}\0` : `${files.join("\n")}\n`;
      if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args.includes("diff")) return diff;
      return `${SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  return { deps, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("pharn-ci check never honours the accept label", () => {
  it("AC-12: mode block on a `|| true` diff exits 1 with TI10 block and no accept fields; --accept-label is an unknown option", async () => {
    const { main } = await import("../src/main.js");
    const diff = fixture("accept-label/or-true.diff");
    const files = fixture("accept-label/files.txt").trim().split("\n");

    const repo = fakeRepo(diff, files);
    const code = await main(CHECK, repo.deps as never);
    expect(code).toBe(1);
    const report = JSON.parse(repo.stdout());
    expectValidReport(report);
    const ti10 = report.testIntegrity.signals.filter((s: { id: string }) => s.id === "TI10");
    expect(ti10).toEqual([expect.objectContaining({ id: "TI10", severity: "block", path: "package.json", line: 7 })]);
    expect(report.testIntegrity.accepted ?? null).toBeNull();
    expect("acceptLabel" in report.testIntegrity).toBe(false);
    const codes = report.messages.map((m: { code: string }) => m.code);
    expect(codes).not.toContain("TEST_INTEGRITY_ACCEPTED");
    expect(codes).not.toContain("TEST_INTEGRITY_ACCEPT_IGNORED");

    // Control: the core step the Action applies would have downgraded this very report, so its absence is the CLI's.
    const { acceptTestIntegrity } = await import("@pharn-ci/core");
    const accepted = acceptTestIntegrity(report, { label: "pharn/accepted", by: "Reviewer-1" });
    expect(accepted.testIntegrity.accepted).toEqual({ label: "pharn/accepted", by: "Reviewer-1" });
    expect(accepted.testIntegrity.signals.filter((s: { id: string }) => s.id === "TI10")[0]?.severity).toBe("warn");

    const flagged = fakeRepo(diff, files);
    const flaggedCode = await main([...CHECK, "--accept-label", "x"], flagged.deps as never);
    expect(flaggedCode).toBe(2);
    expect(flagged.stderr()).toMatch(/unknown option/i);
    expect(flagged.stderr()).toContain("--accept-label");
  });
});
