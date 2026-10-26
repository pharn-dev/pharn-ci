import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// corpus-run-script: docs/PRECISION.md section 2 gains a "How the run works" subsection that names both scripts,
// their commands, the cache, the CSV columns, the review values, the 1 % decision rule and v0.3.0; the "The runs are
// not here yet" limit bullet no longer names scripts/corpus-run.mjs as still to come. Read inside the test bodies.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const section = () => {
  const lines = readFileSync(`${ROOT}docs/PRECISION.md`, "utf8").split("\n");
  const start = lines.indexOf("## 2. Precision corpus");
  expect(start, "docs/PRECISION.md has a line `## 2. Precision corpus`").toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
};

describe("corpus-run-script: docs/PRECISION.md section 2", () => {
  it("AC-13: section 2 has a `How the run works` subsection naming the scripts, commands, cache, columns, review values, rule and v0.3.0", () => {
    const lines = section();
    const start = lines.findIndex((line) => line.startsWith("### How the run works"));
    expect(start, "section 2 has a `### How the run works` subsection").toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith("### ") || line.startsWith("## "));
    const text = (end === -1 ? rest : rest.slice(0, end)).join("\n");
    for (const needle of [
      "scripts/corpus-run.mjs",
      "scripts/corpus-rate.mjs",
      "node scripts/corpus-run.mjs",
      "node scripts/corpus-rate.mjs",
      "~/.cache/pharn-ci-corpus",
      "PHARN_CORPUS_CACHE",
      "repo,pr,signal,severity,path,line,code,detail,verdict,note",
      "TP",
      "FP",
      "unclear",
      "1 %",
      "v0.3.0",
    ]) {
      expect(text, `the subsection contains ${needle}`).toContain(needle);
    }
  });

  // precision-v030: the official run is published, so the `The runs are not here yet` bullet is gone and section 2
  // names the reviewed CSV instead.
  it("AC-13: the `The runs are not here yet` limit bullet is gone and section 2 names fixtures/corpus/review.csv", () => {
    const lines = section();
    expect(
      lines.some((line) => line.includes("The runs are not here yet")),
      "section 2 no longer has the `The runs are not here yet` bullet",
    ).toBe(false);
    expect(lines.join("\n"), "section 2 names the reviewed CSV").toContain("fixtures/corpus/review.csv");
  });
});
