import { check, overlapsForbidden, parsePermissionRule } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { asciiTrim } from "../src/policy/settings/permissionRule.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The allow side trims ASCII whitespace before it parses an entry. It used a `^[ \t…]+|[ \t…]+$` regular expression,
// which is quadratic on a long run of whitespace that is not at the end (CodeQL js/polynomial-redos on PR #116). The
// entry comes from a pull request's settings file, so the trim is now a loop. These tests pin its behaviour and that a
// hostile entry is handled in linear time.

describe("asciiTrim", () => {
  it("removes leading and trailing space, tab, line feed, vertical tab, form feed and carriage return", () => {
    expect(asciiTrim(" \t\n\v\f\rBash(ls)\r\f\v\n\t ")).toBe("Bash(ls)");
    expect(asciiTrim("Bash(ls -la)")).toBe("Bash(ls -la)");
    expect(asciiTrim("  Bash( ls )  ")).toBe("Bash( ls )");
    expect(asciiTrim(" \t \n")).toBe("");
    expect(asciiTrim("")).toBe("");
  });

  it("keeps non-ASCII whitespace, which the allow side does not trim", () => {
    expect(asciiTrim(" Bash(ls) ")).toBe(" Bash(ls) ");
  });

  it("returns the same string when there is nothing to trim", () => {
    const text = "Read(./src/**)";
    expect(asciiTrim(text)).toBe(text);
  });
});

describe("a hostile allow entry with a long run of inner whitespace", () => {
  // 400,000 tabs between two letters: quadratic matching takes minutes, the loop takes microseconds.
  const hostile = `a${"\t".repeat(400_000)}b`;

  it("is parsed and compared without hanging", () => {
    expect(parsePermissionRule(hostile, "allow")).toBeDefined();
    expect(overlapsForbidden(hostile, "Bash(curl:*)")).toBe(false);
    expect(overlapsForbidden(`${"\t".repeat(400_000)}Bash(curl:*)${"\t".repeat(400_000)}`, "Bash(curl:*)")).toBe(true);
  });

  it("goes through check() with a file policy and a committed settings file", () => {
    const settings = JSON.stringify({ permissions: { allow: [hostile, "Bash(curl:*)"] } });
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("diff/empty.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["AGENTS.md", ".claude/settings.json"],
      policy: {
        source: "file",
        version: null,
        path: "policy/org.json",
        document: { version: 1, setup: { forbidden_permissions: ["Bash(curl:*)"] } },
      },
      policySettingsSources: { files: [{ path: ".claude/settings.json", text: settings }], dropped: [] },
    } as never);
    expectValidReport(report);
    const p02 = (report.policy?.violations ?? []).filter((v) => v.id === "P02");
    expect(p02.map((v) => v.detail)).toEqual(["allow rule overlaps forbidden permission Bash(curl:*)"]);
  });
});
