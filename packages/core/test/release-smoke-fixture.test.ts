import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// release-readiness-v020: fixtures/smoke/expected-summary.txt lists the whole lines the release smoke expects in the
// job summary. The footer version is checked separately, so no line pins a version. Read inside the test body.

describe("release-readiness-v020: the smoke fixture's expected summary", () => {
  it("AC-10: expected-summary.txt holds the Test integrity heading and the no-findings line, and no line with pharn-ci followed by a version", () => {
    const lines = readFileSync(`${FIXTURES}smoke/expected-summary.txt`, "utf8")
      .split("\n")
      .map((line) => line.replace(/\r$/, ""));
    expect(lines).toContain("### 🔍 Test integrity");
    expect(lines).toContain("No test-integrity findings (mode: block).");
    expect(lines.filter((line) => /pharn-ci \d/.test(line))).toEqual([]);
  });
});
