import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The docs and the fixture directories are read inside each test body: the AC tests are written before the docs are
// updated and before fixtures/test-integrity-precision/ exists, so nothing that depends on them may run while the file
// loads. Prose is checked loosely (whitespace folded, case ignored) for the rules, thresholds and limits it must name.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PRECISION_FIXTURES = `${ROOT}fixtures/test-integrity-precision/`;

const TI02_CASES = [
  "pass-rename-setup-moved",
  "pass-rename-assertion-changed",
  "pass-rename-literal-changed",
  "ti06-rename-weakened",
  "pass-each-replaced",
  "pass-moved-near-identical",
  "pass-moved-name-contained",
  "block-suite-rewritten",
  "block-hollow-similar-name",
  "block-group-replaced",
  "block-fails-fixed",
  "block-slot-dissimilar",
  "block-each-dissimilar",
  "block-similar-name-elsewhere",
];
const TI01_CASES = [
  "info-moved-names",
  "block-name-missing",
  "block-no-assertions",
  "block-trivial-same-names",
  "info-moved-names-py",
  "pass-snap-renamed",
  "pass-snap-deleted",
];

const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const fold = (text: string) => text.replace(/\s+/g, " ").toLowerCase();

/** The text from a heading line that starts with `heading` to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith(heading));
  expect(at, `the section ${heading}`).toBeGreaterThan(-1);
  const level = (/^#+/.exec(heading)?.[0] ?? "#").length;
  const end = lines.findIndex((line, i) => i > at && /^#+ /.test(line) && (/^#+/.exec(line)?.[0].length ?? 9) <= level);
  return lines.slice(at, end === -1 ? undefined : end).join("\n");
}

/** The `- **What TI01 misses.**` item of LIMITS section 1, up to the next top-level item or heading. */
function ti01Item(text: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("- **What TI01 misses.**"));
  expect(at, "the What TI01 misses item").toBeGreaterThan(-1);
  const end = lines.findIndex((line, i) => i > at && (/^- /.test(line) || /^#+ /.test(line)));
  return lines.slice(at, end === -1 ? undefined : end).join("\n");
}

const textFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
        (n) => n.endsWith(".txt") && statSync(join(dir, n)).isFile(),
      )
    : [];

describe("TI01 and TI02 precision: the docs and the fixtures", () => {
  it("AC-15: docs/LIMITS.md names the three TI02 rules with their thresholds and what they still miss", () => {
    const ti02 = fold(section(read("docs/LIMITS.md"), "### What TI02 misses"));
    for (const [rule, pattern] of [
      ["rename in place", /renamed? in[- ]place/],
      [".each replacement", /\.each/],
      ["cross-file move", /mov(e|ed) to another|another (touched )?(test )?file|cross-file/],
    ] as const) {
      expect(ti02, `the TI02 section names the ${rule} rule`).toMatch(pattern);
    }
    for (const threshold of ["1/2", "3/4", "4/5", "256"]) {
      expect(ti02, `the TI02 section names ${threshold}`).toContain(threshold);
    }
    expect(ti02, "an .each table's rows are not compared").toMatch(/rows/);
    expect(ti02, "a same-slot rename into a different test with shared setup is a pair").toMatch(/same slot|slot/);
    expect(ti02, "a name-only move across files needs body containment").toMatch(/contain/);
    expect(ti02, "a suite rewritten under reworded names is a known false block").toMatch(/known false block/);
    expect(ti02, "which the accept label clears").toMatch(/accept label/);
  });

  it("AC-15: docs/LIMITS.md names the TI01 moved-names rule and the snapshot exclusion, and that a renamed or deleted .snap is still listed in deletedTestFiles", () => {
    const limits = read("docs/LIMITS.md");
    const ti01 = fold(ti01Item(limits));
    expect(ti01, "the TI01 item names the snapshot exclusion").toContain(".snap");
    expect(ti01, "and the moved-tests rule").toMatch(/group name/);
    expect(ti01, "which needs each test's body, not only its name").toMatch(/body/);
    expect(ti01, "which gives info").toMatch(/\binfo\b/);
    expect(fold(limits), "a renamed or deleted .snap is still listed").toMatch(/deletedtestfiles|test_files_deleted/);
  });

  it("AC-15: docs/PRECISION.md section 2 says the rules came from the early corpus dry run and the official numbers come with item 18", () => {
    const corpus = fold(section(read("docs/PRECISION.md"), "## 2. Precision corpus"));
    expect(corpus).toContain("dry run");
    expect(corpus).toMatch(/ti01/);
    expect(corpus).toMatch(/ti02/);
    expect(corpus).toContain("item 18");
  });

  it("AC-15: the CHANGELOG 0.3.0 section has an entry that mentions TI01 and TI02", () => {
    // Shipped in 0.3.0; before that release its entry sat under Unreleased.
    const unreleased = section(read("CHANGELOG.md"), "## [0.3.0]");
    const items: string[] = [];
    for (const line of unreleased.split("\n")) {
      if (line.startsWith("- ")) items.push(line);
      else if (line.startsWith("  ") && items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
    }
    expect(
      items.some((item) => item.includes("TI01") && item.includes("TI02")),
      "one 0.3.0 entry mentions both TI01 and TI02",
    ).toBe(true);
  });

  it("AC-15: fixtures/test-integrity-precision/TI02 and TI01 hold every named case as change.diff with base/ and head/ text files", () => {
    for (const [dir, cases] of [
      ["TI02", TI02_CASES],
      ["TI01", TI01_CASES],
    ] as const) {
      for (const name of cases) {
        const root = `${PRECISION_FIXTURES}${dir}/${name}/`;
        expect(existsSync(`${root}change.diff`), `${dir}/${name}/change.diff`).toBe(true);
        expect(textFiles(`${root}base`).length, `${dir}/${name}/base/ holds text files`).toBeGreaterThan(0);
        expect(textFiles(`${root}head`).length, `${dir}/${name}/head/ holds text files`).toBeGreaterThan(0);
      }
    }
  });
});
