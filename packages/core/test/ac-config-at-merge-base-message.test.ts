import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff/unified.js";
import { configDiffState } from "../src/gateInputs.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";

// CORE-95 in core: how a diff touches the config in use (configDiffState), the one CONFIG_CHANGED_IN_DIFF message that
// says which copy of the config the check ran with (configSource), and TI14 reading the exclusions of the copy the
// change leaves (headConfigExclude). Inputs: fixtures/config-at-merge-base/ and fixtures/gate-tamper/.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";

type Input = Parameters<typeof check>[0];

function run(diff: string, extra: Partial<Input> = {}) {
  const report = check({
    version: "0.12.0",
    coverage: { text: fixture("config-at-merge-base/coverage.info"), format: "lcov" },
    diff: { text: fixture(diff) },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: fixture("config-at-merge-base/files.txt").trim().split("\n"),
    ...extra,
  });
  expectValidReport(report);
  return report;
}

const configMessages = (report: ReturnType<typeof check>) =>
  report.messages.filter((m) => m.code === "CONFIG_CHANGED_IN_DIFF");

describe("CORE-95: core tells the copy of the config the check ran with", () => {
  it("AC-8: configDiffState reads untouched, modified, added and deleted, renames included, and a config outside the repo as untouched", () => {
    const state = (diff: string, configPath?: string) =>
      configDiffState(parseUnifiedDiff(fixture(diff)), configPath, REPO_ROOT);
    expect(state("config-at-merge-base/untouched.diff")).toBe("untouched");
    expect(state("config-at-merge-base/exclude-all/change.diff")).toBe("modified");
    expect(state("config-at-merge-base/added/change.diff")).toBe("added");
    expect(state("config-at-merge-base/deleted.diff")).toBe("deleted");
    expect(state("gate-tamper/config-renamed-from.diff", "config/pharn.yml")).toBe("deleted");
    expect(state("gate-tamper/config-renamed-to.diff", "config/pharn.yml")).toBe("added");
    expect(state("gate-tamper/config-custom-modified.diff", `${REPO_ROOT}/config/pharn.yml`)).toBe("modified");
    // The default config is not the one in use when another is named, and one outside the repo matches nothing.
    expect(state("config-at-merge-base/exclude-all/change.diff", "config/pharn.yml")).toBe("untouched");
    expect(state("config-at-merge-base/exclude-all/change.diff", "/elsewhere/ci.yml")).toBe("untouched");
  });

  it("AC-9: one CONFIG_CHANGED_IN_DIFF says which copy was used; it is an error only when the base copy was unreadable under a threshold or in mode block", () => {
    const diff = "config-at-merge-base/exclude-all/change.diff";
    // Control: with no configSource the message is the one it always was.
    const plain = configMessages(run(diff, { threshold: 80 }));
    expect(plain).toHaveLength(1);
    expect(plain[0]?.level).toBe("warn");
    expect(plain[0]?.text).toBe(
      "This change edits files that configure this check: `.pharn/ci.yml`. Review them before trusting the verdict.",
    );

    const base = configMessages(run(diff, { configSource: "merge-base" }));
    expect(base.map((m) => m.level)).toEqual(["warn"]);
    expect(base[0]?.text).toContain(
      "This check used `.pharn/ci.yml` as it is at the merge base, not as this change leaves it; the change to it applies after merge.",
    );
    const absent = configMessages(run("config-at-merge-base/added/change.diff", { configSource: "absent" }));
    expect(absent.map((m) => m.level)).toEqual(["warn"]);
    expect(absent[0]?.text).toContain("`.pharn/ci.yml` is new in this change, so this check ran without it");

    for (const [extra, level] of [
      [{ threshold: 80 }, "error"],
      [{ threshold: 0 }, "error"],
      [{ testIntegrityMode: { input: "block" } }, "error"],
      [{ testIntegrityMode: { input: "warn" } }, "warn"],
      [{}, "warn"],
    ] as const) {
      const label = JSON.stringify(extra);
      const report = run(diff, { configSource: "unreadable", ...extra } as Partial<Input>);
      const unreadable = configMessages(report);
      expect(
        unreadable.map((m) => m.level),
        label,
      ).toEqual([level]);
      expect(unreadable[0]?.text, label).toContain("could not be read at the merge base");
      expect(unreadable[0]?.text, label).toContain("`fetch-depth: 0`");
      expect(unreadable[0]?.text.includes("this fails the check"), label).toBe(level === "error");
      if (level === "error") expect(report.verdict, label).toBe("fail");
    }

    // A change that touches only a workflow names no copy of the config, whatever configSource says.
    const workflow = configMessages(
      run("gate-tamper/workflow-modified.diff", { configSource: "unreadable", threshold: 80 }),
    );
    expect(workflow.map((m) => m.level)).toEqual(["warn"]);
    expect(workflow[0]?.text).not.toContain("merge base");
  });

  it("AC-10: TI14 still reports an exclusion appended to the copy the change leaves, from headConfigExclude", () => {
    const diff = "config-at-merge-base/exclude-all/change.diff";
    const mode = { testIntegrityMode: { input: "block" as const } };
    // Control: the base config's patterns alone cannot tell the appended "**" item from any other list item.
    const without = run(diff, { ...mode, exclude: ["src/b.ts"], configSource: "merge-base" });
    expect(without.testIntegrity.signals.filter((s) => s.id === "TI14")).toEqual([]);
    const withHead = run(diff, {
      ...mode,
      exclude: ["src/b.ts"],
      configSource: "merge-base",
      headConfigExclude: ["src/b.ts", "**"],
    });
    const ti14 = withHead.testIntegrity.signals.filter((s) => s.id === "TI14");
    expect(ti14.map((s) => [s.path, s.line, s.severity])).toEqual([[".pharn/ci.yml", 5, "block"]]);
    // The head copy's patterns reach TI14 only: diff coverage still measures src/a.ts.
    expect(withHead.diffCoverage?.percent).toBe(50);
    const message = withHead.messages.find((m) => m.code === "TEST_INTEGRITY_TI14");
    expect(message?.text).toContain("Once merged, the looser setting applies to every later pull request");
  });
});
