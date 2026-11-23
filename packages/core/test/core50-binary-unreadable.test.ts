import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptTestIntegrity } from "../src/acceptLabel.js";
import type { TestSourceDrop, TestSourceDropReason } from "../src/testSources.js";

import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";

// CORE-50 (binary-diff-not-blind), not an AC test: the three ways the reason `binary` reaches the
// TEST_INTEGRITY_INDEX_UNAVAILABLE message, and how the message tells them apart.
//  - head-binary-text-diff: git shows a text diff, but the head text is binary for the sources (a NUL byte or bytes that
//    are not UTF-8) while the merge-base text indexed: a change made unreadable, an error in `block`.
//  - base-binary-text-diff: the merge-base text is the binary one and the head indexed: not the change's doing, so the
//    message stays a warning in the TI02 and TI05 sentence.
//  - binary-modified-both-dropped: a binary diff entry whose sides were both dropped as binary: the flagged diff entry
//    wins the merge, so the message is an error, and the path is named once.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const ACCEPT = { label: "pharn/accepted", by: "Reviewer-1" };

interface Side {
  files: { path: string; text: string }[];
  dropped: TestSourceDrop[];
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<path>.txt` (a test source text) and `<path>.dropped` (a drop reason) files under a case's side directory. */
function readSide(dir: string): Side {
  const side: Side = { files: [], dropped: [] };
  if (!existsSync(dir)) return side;
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile());
  for (const name of names) {
    const text = readFileSync(join(dir, name), "utf8");
    if (name.endsWith(".txt")) side.files.push({ path: name.slice(0, -".txt".length), text });
    else if (name.endsWith(".dropped"))
      side.dropped.push({ path: name.slice(0, -".dropped".length), reason: text.trim() as TestSourceDropReason });
  }
  side.files.sort(byPath);
  side.dropped.sort(byPath);
  return side;
}

function run(name: string, mode: "block" | "warn") {
  const dir = `${FIXTURES}test-integrity/index-unavailable/${name}`;
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: readFileSync(join(dir, "change.diff"), "utf8") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["src/cart.test.ts", "src/cart.ts"],
    testIntegrityMode: { input: mode },
    testSources: { base: readSide(join(dir, "base")), head: readSide(join(dir, "head")) },
  });
  expectValidReport(report);
  return report;
}

const unavailable = (report: ReturnType<typeof run>) => report.messages.filter((m) => m.code === CODE);

describe("CORE-50: how the reason binary reaches TEST_INTEGRITY_INDEX_UNAVAILABLE", () => {
  it("head-binary-text-diff: a head text that is binary, with a text diff and a base that indexed, is an error in block, a warning in warn, and lowered by the accept label", () => {
    const block = run("head-binary-text-diff", "block");
    const [message] = unavailable(block);
    expect(unavailable(block)).toHaveLength(1);
    expect(message?.level).toBe("error");
    expect(message?.text).toContain("These touched test files are binary in the diff or in their text at HEAD");
    expect(message?.text).toContain("`src/cart.test.ts` (`binary`)");
    expect(block.verdict).toBe("fail");

    const warn = run("head-binary-text-diff", "warn");
    expect(unavailable(warn).map((m) => m.level)).toEqual(["warn"]);

    const accepted = acceptTestIntegrity(structuredClone(block), ACCEPT);
    expectValidReport(accepted);
    expect(unavailable(accepted).map((m) => m.level)).toEqual(["warn"]);
  });

  it("base-binary-text-diff: a base text that is binary, with a head that indexed, stays a warning in the TI02 and TI05 sentence", () => {
    const block = run("base-binary-text-diff", "block");
    expect(unavailable(block)).toHaveLength(1);
    const message = unavailable(block)[0];
    expect(message?.level).toBe("warn");
    expect(message?.text).toContain("TI02 and TI05 could not compare these touched test files");
    expect(message?.text).toContain("`src/cart.test.ts` (`binary`)");
    expect(message?.text).not.toContain("binary in the diff");
    expect(block.verdict).not.toBe("fail");
  });

  it("binary-modified-both-dropped: the flagged diff entry wins the merge, so the message is an error and names the file once", () => {
    const block = run("binary-modified-both-dropped", "block");
    expect(unavailable(block)).toHaveLength(1);
    const message = unavailable(block)[0];
    expect(message?.level).toBe("error");
    expect((message?.text.match(/`src\/cart\.test\.ts`/g) ?? []).length).toBe(1);
    expect(message?.text).toContain("binary in the diff or in their text at HEAD");
    expect(block.verdict).toBe("fail");

    const warn = run("binary-modified-both-dropped", "warn");
    expect(unavailable(warn).map((m) => m.level)).toEqual(["warn"]);
  });
});
