import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-verdict-callout AC-5. check() and the renderer are loaded inside the test body: the AC tests are written
// before the build, so nothing the build changes may run while the file loads.
//
// The report data must not change with this increment. That already holds before the build, so the test also checks
// that it reads the increment's output: the same report renders with the verdict callout under its heading. Without
// the callout the test fails; with it, the data comparison decides.

/** sha256 of fixtures/golden/report.json as committed before this increment: the report data must not change. */
const GOLDEN_JSON_SHA256 = "37d7101a203ba54c38b9636631edc8c7bc03e82ff6deaaa0de84a2f62f8635f7";

describe("check(): report data unchanged by the verdict callout", () => {
  it("AC-5: the golden report equals the committed report.json and validates against the schema", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const committed = fixture("golden/report.json");
    expect(createHash("sha256").update(committed).digest("hex"), "report.json as committed before").toBe(
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

    // The data above is the data the callout-bearing rendering is made from.
    expect(renderMarkdown(report).split("\n")[4]).toBe("> [!CAUTION]");
  });
});
