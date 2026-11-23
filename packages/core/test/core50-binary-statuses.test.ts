import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestSourceDrop, TestSourceDropReason } from "../src/testSources.js";

import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";

// CORE-50 (binary-diff-not-blind), not an AC test: the statuses the acceptance criteria do not name, each pinned by a
// fixture. A renamed binary package.json (judged from the sources when both texts read as JSON, else one fixed
// finding), an added and a renamed binary workflow, a renamed and a deleted binary config (TI14), and an added binary
// config (no TI14, as the control).

const REPO_ROOT = "/home/runner/work/demo/demo";
const CONFIG = ".pharn/ci.yml";
const BINARY = "git shows this file as binary, so its changes could not be read.";

interface Side {
  files: { path: string; text: string }[];
  dropped: TestSourceDrop[];
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

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

function run(dir: string, mode: "block" | "warn", file = "change.diff") {
  const root = `${FIXTURES}test-integrity/${dir}`;
  const base = readSide(join(root, "base"));
  const head = readSide(join(root, "head"));
  const hasSources = base.files.length + base.dropped.length + head.files.length + head.dropped.length > 0;
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: readFileSync(join(root, file), "utf8") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["package.json", "src/cart.test.ts", "src/cart.ts"],
    testIntegrityMode: { input: mode },
    configPath: CONFIG,
    ...(hasSources ? { testSources: { base, head } } : {}),
  });
  expectValidReport(report);
  return report;
}

const signalsOf = (report: ReturnType<typeof run>, id: string) =>
  report.testIntegrity.signals.filter((s) => s.id === id);

describe("CORE-50: the statuses no acceptance criterion names", () => {
  it("TI10/block-binary-renamed-sources: a binary rename of package.json is judged from the sources, like its text diff", () => {
    const fromBinary = signalsOf(run("TI10/block-binary-renamed-sources", "block"), "TI10");
    const fromText = signalsOf(run("TI10/block-binary-renamed-sources", "block", "text.diff"), "TI10");
    expect(fromText.length, "the text diff gives a TI10").toBeGreaterThan(0);
    expect(fromText.every((s) => s.severity === "block" && s.path === "pkg/b/package.json" && s.line === 4)).toBe(true);
    expect(fromBinary).toEqual(fromText);
    expect(fromBinary.filter((s) => s.detail === BINARY)).toEqual([]);
  });

  it("TI10/block-binary-renamed-no-sources: the same rename with no sources is one fixed finding at the new path", () => {
    expect(signalsOf(run("TI10/block-binary-renamed-no-sources", "block"), "TI10")).toEqual([
      expect.objectContaining({
        id: "TI10",
        severity: "block",
        path: "pkg/b/package.json",
        line: null,
        detail: BINARY,
      }),
    ]);
  });

  it.each([
    ["TI11/block-binary-workflow-added", ".github/workflows/nightly.yml"],
    ["TI11/block-binary-workflow-renamed", ".github/workflows/tests.yml"],
  ])("%s: one fixed TI11 finding at the new path, block in block and warn in warn", (dir, path) => {
    for (const mode of ["block", "warn"] as const) {
      expect(signalsOf(run(dir, mode), "TI11"), `${dir} ${mode}`).toEqual([
        expect.objectContaining({ id: "TI11", severity: mode, path, line: null, detail: BINARY }),
      ]);
    }
  });

  it.each(["TI14/block-binary-config-renamed", "TI14/block-binary-config-deleted"])(
    "%s: one fixed TI14 finding at the config's own path",
    (dir) => {
      expect(signalsOf(run(dir, "block"), "TI14")).toEqual([
        expect.objectContaining({ id: "TI14", severity: "block", path: CONFIG, line: null, detail: BINARY }),
      ]);
    },
  );

  it("TI14/pass-binary-config-added: an added binary config gives no TI14, the control of the two cases above", () => {
    expect(signalsOf(run("TI14/pass-binary-config-added", "block"), "TI14")).toEqual([]);
  });
});
