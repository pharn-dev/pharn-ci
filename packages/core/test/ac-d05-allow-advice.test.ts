import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render/markdown.js";
import { dependencyCase, run } from "./dependencies-helpers.js";

// d05-private-registry-allowlist, AC-12: a team whose check goes red on D05 because of its own registry is told what to
// do. In the comment, the hint line under the first D05 finding of the fixtures/dependencies/d05-lockfile case names
// the `dependency-allowed-hosts` input and says it is for a registry the team runs.

describe("the DEPENDENCY_D05 advice", () => {
  it("AC-12: the hint under the D05 finding names dependency-allowed-hosts for a registry the team runs", () => {
    const report = run(dependencyCase("d05-lockfile"));
    expect(report.messages.some((m) => m.code === "DEPENDENCY_D05")).toBe(true);
    const lines = renderMarkdown(report).split("\n");
    const finding = lines.findIndex((line) => line.includes("**D05**"));
    expect(finding, "no D05 finding in the comment").toBeGreaterThan(-1);
    const hint = lines.slice(finding + 1).find((line) => line.trimStart().startsWith("- Hint:"));
    expect(hint, "no hint line under the D05 finding").toBeDefined();
    expect(hint).toContain("dependency-allowed-hosts");
    expect(hint).toMatch(
      /registr(?:y|ies)\b[^.]*\b(?:your|the) team runs|\b(?:your|the) team(?:'s)? (?:own )?registr/i,
    );
  });
});
