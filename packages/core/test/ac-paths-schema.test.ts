import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// The schema, the validator, check() and the fixtures are loaded inside the test body, like the other AC tests:
// fixtures/coverage-paths/ does not exist before the build.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODES = ["COVERAGE_PATHS_UNMATCHED", "COVERAGE_PATHS_PARTIALLY_UNMATCHED"];

describe("schema/report.v1.json: the coverage path message codes", () => {
  it("AC-10: the message code description names both codes after the Known codes list, and reports carrying them validate", async () => {
    const schema = JSON.parse(readFileSync(new URL("../../../schema/report.v1.json", import.meta.url), "utf8"));
    const description: string = schema.$defs.message.properties.code.description;
    const known = description.match(/Known codes: ([^.]+)\./);
    expect(known, 'the description lists "Known codes:"').not.toBeNull();
    const knownCodes = (known?.[1] ?? "").split(",").map((code) => code.trim());
    const after = description.slice((known?.index ?? 0) + (known?.[0].length ?? 0));
    for (const code of CODES) {
      expect(knownCodes, `${code} stays out of the Known codes list`).not.toContain(code);
      expect(after, `${code} is named after the Known codes list`).toMatch(new RegExp(`(?<![\\w])${code}(?![\\w])`));
    }
    expect(after, "the appended text opens no second Known codes list").not.toContain("Known codes:");

    const { check } = await import("../src/check.js");
    const { expectValidReport } = await import("./schema.js");
    const run = (dir: string, threshold: number) =>
      check({
        version: "0.1.0",
        coverage: { text: fixture(`coverage-paths/${dir}/coverage.info`), format: "lcov" },
        diff: { text: fixture(`coverage-paths/${dir}/pr.diff`) },
        repoRoot: REPO_ROOT,
        threshold,
        repoFiles: fixture(`coverage-paths/${dir}/files.txt`).trim().split("\n"),
      });

    for (const [dir, threshold, code] of [
      ["absolute-elsewhere", 100, "COVERAGE_PATHS_UNMATCHED"],
      ["partial", 80, "COVERAGE_PATHS_PARTIALLY_UNMATCHED"],
    ] as const) {
      const report = run(dir, threshold);
      expect(
        report.messages.map((message) => message.code),
        dir,
      ).toContain(code);
      expectValidReport(report);
    }
  });
});
