import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-logo-2 AC-5. check() and the renderer are loaded inside the test body: the AC tests are written before
// the build, so nothing the build changes may run while the file loads.
//
// The report data must not change with this increment. That already holds before the build, so the test also checks
// that it reads the increment's output: the same report renders with the logo line first (AC-2's Given). Without the
// logo the test fails, with it the data comparison decides.

/** The one fixed logo line, written here so the test does not reuse the renderer's own constant. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

/** sha256 of fixtures/golden/report.json as committed before this increment: the report data must not change. */
const GOLDEN_JSON_SHA256 = "37d7101a203ba54c38b9636631edc8c7bc03e82ff6deaaa0de84a2f62f8635f7";

/**
 * The committed golden report.json in its Report v1 form, the bytes the hash above was taken from. Report v2 changed
 * it only by setting schemaVersion to 2 and appending the empty testIntegrity block, both asserted below.
 */
function asV1File(json: string): string {
  const parsed = JSON.parse(json);
  expect(parsed.schemaVersion).toBe(2);
  expect(parsed.testIntegrity).toEqual({
    mode: "warn",
    source: "default",
    verdict: "pass",
    signals: [],
    languages: [],
  });
  const { testIntegrity: _testIntegrity, ...v1 } = { ...parsed, schemaVersion: "1" };
  return `${JSON.stringify(v1, null, 2)}\n`;
}

describe("check(): report data unchanged by the header logo", () => {
  it("AC-5: the golden report equals the committed report.json and validates against the schema", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const committed = fixture("golden/report.json");
    expect(createHash("sha256").update(asV1File(committed)).digest("hex"), "report.json as committed before").toBe(
      GOLDEN_JSON_SHA256,
    );

    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(report);
    expect(report).toEqual(JSON.parse(committed));

    // The data above is the data the logo-headed rendering is made from.
    expect(renderMarkdown(report).split("\n")[0]).toBe(LOGO);
  });
});
