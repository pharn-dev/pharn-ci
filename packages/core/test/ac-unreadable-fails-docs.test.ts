import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CORE-69. The docs say what now fails block (a modified test file the change makes unreadable at HEAD, more than 5000
// changed lines in one, a modified `.py` test file without python3), what still only warns, and the read order. The
// files are read inside the test body.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The text from the line that starts with `start` up to the next line that starts with `end` (or the end). */
function section(text: string, start: string, end: RegExp): string {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => line.startsWith(start));
  expect(from, `a line starting ${start}`).toBeGreaterThan(-1);
  const to = lines.findIndex((line, i) => i > from && end.test(line));
  return lines.slice(from, to === -1 ? undefined : to).join("\n");
}

/** The bullets of a Markdown list, each with its continuation lines joined by spaces. */
function bullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) out.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

describe("CORE-69: LIMITS, README and CHANGELOG", () => {
  it("AC-21: LIMITS §2 and §8, the README test-integrity chapter and the Unreleased Changed list say what now fails block, what still warns, and the read order", () => {
    const limits = read("docs/LIMITS.md");
    const two = section(limits, "## 2.", /^## 3\./);
    expect(two, "LIMITS §2 no longer says the per-file form stays a warning").not.toContain("stays a warning in block");
    for (const phrase of [
      "`too-deep`",
      "`too-large`",
      "`over-file-cap`",
      "more than 5000 changed lines",
      "`python3`",
      "an added test file",
      "at the merge base either",
      "`over-total-cap`",
      "the other reasons at HEAD",
    ]) {
      expect(two, `LIMITS §2 says ${phrase}`).toContain(phrase);
    }

    const eight = section(limits, "## 8.", /^## 9\./);
    expect(eight, "LIMITS §8 gives the read order").toContain("read first on both sides");
    expect(eight, "LIMITS §8 gives the read order").toContain("then the added and deleted test files");

    const readme = section(read("README.md"), "## Test integrity", /^## /);
    expect(readme, "the README chapter no longer says the per-file form stays a warning").not.toContain(
      "the per-file form stays a warning",
    );
    expect(readme).toContain("more than 5000 changed lines");
    expect(readme).toContain("read before the added and deleted ones");

    const unreleased = section(read("CHANGELOG.md"), "## [Unreleased]", /^## \[/);
    const changed = section(unreleased, "### Changed", /^### /);
    const core69 = bullets(changed).filter((b) => b.includes("CORE-69"));
    expect(core69, "one Unreleased → Changed line names CORE-69").toHaveLength(1);
    expect(core69[0]).toContain("block");
    expect(core69[0]).toContain("fails");
  });
});
