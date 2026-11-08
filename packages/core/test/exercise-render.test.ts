import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { MESSAGE_HINTS, renderMarkdown } from "../src/render/markdown.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// A8 step 1: the comment shows the tests-exercise check under "🔍 Test integrity" as one warn line with its hint and a
// collapsed list of paths, and leaves the message out of "💬 Messages" there. A report from elsewhere is untrusted: an
// exercise object of the wrong shape shows nothing in the section and keeps the message in Messages.

const HINT =
  "Add or update a test that imports each listed file and asserts on the changed behaviour, or say in the PR why no test changes. This is a warning only.";

function report(): Report {
  const made = check({
    version: "0.1.0",
    coverage: { text: "SF:src/cart.ts\nDA:2,1\nend_of_record\n", format: "lcov" },
    diff: { text: fixture("exercise/warn-no-test/change.diff") },
    threshold: null,
    repoFiles: fixture("exercise/warn-no-test/files.txt").trim().split("\n"),
    testSources: { base: { files: [], dropped: [] }, head: { files: [], dropped: [] } },
  });
  expectValidReport(made);
  return made;
}

/** The lines of the Test integrity section, heading to the next heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf("### 🔍 Test integrity");
  const end = lines.findIndex((line, i) => i > start && line.startsWith("### "));
  return lines.slice(start, end === -1 ? lines.length : end);
}

describe("the tests-exercise lines of the comment", () => {
  it("has the fixed hint", () => {
    expect(MESSAGE_HINTS.TESTS_NOT_EXERCISING_CHANGES).toBe(HINT);
  });

  it("shows one warn line, the hint and a collapsed list under Test integrity, and no TESTS_NOT_EXERCISING_CHANGES in Messages", () => {
    const markdown = renderMarkdown(report());
    expect(section(markdown)).toEqual([
      "### 🔍 Test integrity",
      "",
      "No test-integrity findings (mode: warn).",
      "",
      "- ⚠️ **Tests exercise changes** — 1 of 1 changed source file is not imported by a test file this change adds or modifies.",
      `  - Hint: ${HINT}`,
      "",
      "<details><summary>Not exercised: 1 file</summary>",
      "",
      "- `src/cart.ts`",
      "",
      "</details>",
      "",
    ]);
    expect(markdown).not.toContain("`TESTS_NOT_EXERCISING_CHANGES`");
  });

  it("cuts the list at maxRows and counts the rest, the truncated ones included", () => {
    const base = report();
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];
    const wide: Report = {
      ...base,
      testIntegrity: { ...base.testIntegrity, exercise: { checked: 9, notExercised: paths, truncated: 2 } },
    };
    const lines = section(renderMarkdown(wide, { maxRows: 3 }));
    expect(lines).toContain(
      "- ⚠️ **Tests exercise changes** — 7 of 9 changed source files are not imported by a test file this change adds or modifies.",
    );
    expect(lines).toContain("<details><summary>Not exercised: 7 files</summary>");
    expect(lines.filter((line) => line.startsWith("- `"))).toEqual(["- `src/a.ts`", "- `src/b.ts`", "- `src/c.ts`"]);
    expect(lines).toContain("- _…and 4 more files in report.json._");
  });

  it("shows nothing in mode off, and keeps the message in Messages when the exercise object has the wrong shape", () => {
    const base = report();
    const off: Report = { ...base, testIntegrity: { ...base.testIntegrity, mode: "off" } };
    expect(section(renderMarkdown(off)).join("\n")).not.toContain("Tests exercise changes");
    const hostile = {
      ...base,
      testIntegrity: { ...base.testIntegrity, exercise: { checked: "x", notExercised: "src/cart.ts" } },
    } as unknown as Report;
    const markdown = renderMarkdown(hostile);
    expect(section(markdown).join("\n")).not.toContain("Tests exercise changes");
    expect(markdown).toContain("`TESTS_NOT_EXERCISING_CHANGES`");
    expect(markdown).toContain(`  - Hint: ${HINT}`);
  });

  it("neutralizes a hostile path in the list", () => {
    const base = report();
    // A right-to-left override, written by code point so the source holds no invisible character.
    const override = String.fromCharCode(0x202e);
    const replacement = String.fromCharCode(0xfffd);
    const odd: Report = {
      ...base,
      testIntegrity: { ...base.testIntegrity, exercise: { checked: 1, notExercised: [`src/a|b\`c${override}.ts`] } },
    };
    expect(section(renderMarkdown(odd))).toContain(`- \`src/a\\|b'c${replacement}.ts\``);
  });
});
