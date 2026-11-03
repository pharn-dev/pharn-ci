import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Review finding 22 (v0.4.0): a modified or renamed test-runner config whose settings were read at the merge base, and
// that is not found (an opaque wrapper) or not read (padded past a cap, nested too deep) at HEAD, gives one TI09 for
// `(config)` at the mode's level, so a one-line wrapper cannot turn a block into a warn. An added config, a config that
// was already unreadable at base and a single value that is not a literal keep their old outcome.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI09 = `${FIXTURES}test-integrity/TI09`;
const PATH = "vitest.config.ts";
const CAP = 524288;
const NOT_FOUND = "(config) could no longer be compared at head: the config was read at base but not found at head.";
const NOT_READ =
  "(config) could no longer be compared at head: the config was read at base but could not be read at head.";

interface SourceFile {
  path: string;
  text: string;
}
interface Side {
  files: SourceFile[];
  dropped: { path: string; reason: string }[];
}

/** The `<logical path>.txt` files under one side of a fixture case. */
function sideFiles(dir: string): SourceFile[] {
  try {
    statSync(dir);
  } catch {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt"))
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function run(diff: string, base: Side, head: Side, mode: "block" | "warn" | "off" = "block") {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", ...head.files.map((file) => file.path)].sort(),
    testIntegrityMode: { input: mode },
    testSources: { base, head },
  });
  expectValidReport(report);
  return {
    report,
    signals: report.testIntegrity.signals.filter((signal) => signal.id === "TI09"),
    unavailable: report.messages.filter((message) => message.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE"),
  };
}

function runCase(name: string, mode: "block" | "warn" | "off" = "block") {
  const dir = join(TI09, name);
  return run(
    readFileSync(join(dir, "change.diff"), "utf8"),
    { files: sideFiles(join(dir, "base")), dropped: [] },
    { files: sideFiles(join(dir, "head")), dropped: [] },
    mode,
  );
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

const BASE = readFileSync(join(TI09, "block-opaque-head/base", `${PATH}.txt`), "utf8");
const NARROWED = BASE.replace('"src/**/*.test.ts"', '"src/**/*.fast.test.ts"');
const one = (path: string, text: string): Side => ({ files: [{ path, text }], dropped: [] });

describe("TI09: a config read at base that cannot be compared at head", () => {
  it("an IIFE head around a narrowed include is one (config) TI09 at the mode's level, with a fixed detail and no file text", () => {
    const block = runCase("block-opaque-head", "block");
    expect(block.signals).toEqual([{ id: "TI09", severity: "block", path: PATH, line: null, detail: NOT_FOUND }]);
    expect(block.report.verdict, "the block fails the check").toBe("fail");
    expect(block.unavailable, "a config that was read is not named unavailable").toEqual([]);

    const warn = runCase("block-opaque-head", "warn");
    expect(warn.signals).toEqual([{ id: "TI09", severity: "warn", path: PATH, line: null, detail: NOT_FOUND }]);

    expect(runCase("block-opaque-head", "off").signals, "mode off: nothing").toEqual([]);

    // Control: the same narrowing without the wrapper is the rule's own block on test.include.
    const plain = run(diffOf(PATH, BASE, NARROWED), one(PATH, BASE), one(PATH, NARROWED));
    expect(plain.signals.map((s) => [s.severity, s.detail.startsWith("test.include")])).toEqual([["block", true]]);
  });

  it("a head nested too deep is one (config) TI09 at the mode's level and stays named with too-deep", () => {
    for (const mode of ["block", "warn"] as const) {
      const { signals, unavailable } = runCase("block-too-deep-head", mode);
      expect(signals, mode).toEqual([{ id: "TI09", severity: mode, path: PATH, line: null, detail: NOT_READ }]);
      expect(unavailable, `${mode}: one index-unavailable message`).toHaveLength(1);
      expect(unavailable[0]?.text).toContain("too-deep");
      expect(unavailable[0]?.text).toContain(PATH);
    }
  });

  it("a head padded past the size cap, or dropped by the source reader, is one block (config) TI09", () => {
    const padded = `${NARROWED}// ${"x".repeat(CAP)}\n`;
    expect(padded.length).toBeGreaterThan(CAP);
    const diff = diffOf(PATH, BASE, NARROWED);
    const large = run(diff, one(PATH, BASE), one(PATH, padded));
    expect(large.signals).toEqual([{ id: "TI09", severity: "block", path: PATH, line: null, detail: NOT_READ }]);
    expect(large.unavailable[0]?.text).toContain("too-large");

    for (const reason of ["too-large", "over-file-cap", "over-total-cap"]) {
      const dropped = run(diff, one(PATH, BASE), { files: [], dropped: [{ path: PATH, reason }] });
      expect(dropped.signals, reason).toEqual([
        { id: "TI09", severity: "block", path: PATH, line: null, detail: NOT_READ },
      ]);
      expect(dropped.unavailable[0]?.text, reason).toContain(reason);
    }
  });

  it("a renamed config with an opaque head is one block (config) TI09 at the head path", () => {
    const head = readFileSync(join(TI09, "block-opaque-head/head", `${PATH}.txt`), "utf8");
    const diff = `${["diff --git a/vitest.config.ts b/vitest.config.mts", "similarity index 50%", "rename from vitest.config.ts", "rename to vitest.config.mts", "--- a/vitest.config.ts", "+++ b/vitest.config.mts", "@@ -3 +3 @@", "-export default defineConfig({", "+export default (() =>"].join("\n")}\n`;
    const { signals } = run(diff, one(PATH, BASE), one("vitest.config.mts", head));
    expect(signals).toEqual([
      { id: "TI09", severity: "block", path: "vitest.config.mts", line: null, detail: NOT_FOUND },
    ]);
  });

  it("an added opaque config, a config opaque at both sides and one unreadable at base give no TI09; a non-literal value stays warn", () => {
    expect(runCase("pass-added-opaque-config").signals, "added").toEqual([]);
    expect(runCase("pass-opaque-base-and-head").signals, "opaque at base and head").toEqual([]);

    const brokenBase = BASE.replace("});", "}");
    const head = readFileSync(join(TI09, "block-opaque-head/head", `${PATH}.txt`), "utf8");
    const broken = run(diffOf(PATH, brokenBase, head), one(PATH, brokenBase), one(PATH, head));
    expect(broken.signals, "unreadable at base: no TI09").toEqual([]);
    expect(broken.unavailable[0]?.text, "named with its reason").toContain("syntax-error");

    const brokenHead = run(diffOf(PATH, brokenBase, `${head}// ${"x".repeat(CAP)}\n`), one(PATH, brokenBase), {
      files: [{ path: PATH, text: `${head}// ${"x".repeat(CAP)}\n` }],
      dropped: [],
    });
    expect(brokenHead.signals, "unreadable at base and at head: no TI09").toEqual([]);

    const imported = BASE.replace('["src/**/*.test.ts"]', "files").replace(
      'from "vitest/config";',
      'from "vitest/config";\nimport { files } from "./files";',
    );
    const value = run(diffOf(PATH, BASE, imported), one(PATH, BASE), one(PATH, imported));
    expect(value.signals.map((s) => s.severity)).toEqual(["warn"]);
    expect(value.signals[0]?.detail).toContain("test.include cannot be compared");
  });
});
