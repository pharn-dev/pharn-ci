import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). check() is loaded inside each test body: the AC tests are written before TI11 and TI14
// report a workflow or the config in use that git shows as binary, so nothing the build changes may run while the file
// loads. The case diffs are read inside the test bodies, and their binary entries are checked first.

const REPO_ROOT = "/home/runner/work/demo/demo";
const BINARY = "git shows this file as binary, so its changes could not be read.";
const CONFIG = ".pharn/ci.yml";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Message {
  code: string;
  level: string;
}
interface Report {
  messages: Message[];
  testIntegrity: { signals: Signal[] };
}
interface Entry {
  oldPath: string;
  path: string;
  lines: string[];
}

function entries(diff: string): Entry[] {
  const out: Entry[] = [];
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (header) {
      out.push({ oldPath: header[1] as string, path: header[2] as string, lines: [line] });
      continue;
    }
    out.at(-1)?.lines.push(line);
  }
  return out;
}

const caseDiff = (dir: string) => readFileSync(`${FIXTURES}test-integrity/${dir}/change.diff`, "utf8");
const isBinary = (entry: Entry) => entry.lines.some((l) => /^Binary files .* differ$/.test(l));

async function run(diff: string, mode: "block" | "warn"): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [".github/workflows/ci.yml", CONFIG, "src/cart.test.ts", "src/cart.ts"],
    testIntegrityMode: { input: mode },
    configPath: CONFIG,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const signalsOf = (report: Report, id: string) => report.testIntegrity.signals.filter((s) => s.id === id);

describe("CORE-50: TI11 and TI14 report a workflow or the config in use that git shows as binary", () => {
  it("AC-11: a modified and a deleted binary workflow each give exactly one TI11 with the fixed binary detail: block and an error in block, warn in warn", async () => {
    for (const [name, kind] of [
      ["TI11/block-binary-workflow-modified", "modified"],
      ["TI11/block-binary-workflow-deleted", "deleted"],
    ] as const) {
      const diff = caseDiff(name);
      const workflows = entries(diff).filter((e) => e.oldPath.startsWith(".github/workflows/"));
      expect(workflows, `${name}: one workflow entry`).toHaveLength(1);
      const workflow = workflows[0] as Entry;
      expect(isBinary(workflow), `${name}: a binary entry`).toBe(true);
      expect(workflow.lines.includes("deleted file mode 100644"), `${name}: ${kind}`).toBe(kind === "deleted");
      const path = workflow.path;

      const block = await run(diff, "block");
      expect(signalsOf(block, "TI11"), `${name}: one block TI11`).toEqual([
        expect.objectContaining({ id: "TI11", severity: "block", path, line: null, detail: BINARY }),
      ]);
      expect(
        block.messages.filter((m) => m.code === "TEST_INTEGRITY_TI11").map((m) => m.level),
        `${name}: one TEST_INTEGRITY_TI11 error`,
      ).toEqual(["error"]);

      const warn = await run(diff, "warn");
      expect(signalsOf(warn, "TI11"), `${name}: one warn TI11`).toEqual([
        expect.objectContaining({ id: "TI11", severity: "warn", path, line: null, detail: BINARY }),
      ]);
    }
  });

  it("AC-12: a binary .pharn/ci.yml that is the config in use gives exactly one TI14 block with the fixed binary detail; a binary YAML file that is not the config gives none", async () => {
    const modified = caseDiff("TI14/block-binary-config-modified");
    const config = entries(modified).filter((e) => e.path === CONFIG);
    expect(config, "an entry for the config in use").toHaveLength(1);
    expect(isBinary(config[0] as Entry), "the config entry is binary").toBe(true);
    expect(
      config[0]?.lines.some((l) => l.startsWith("deleted file mode") || l.startsWith("new file mode")),
      "the config is modified",
    ).toBe(false);

    const block = await run(modified, "block");
    expect(signalsOf(block, "TI14")).toEqual([
      expect.objectContaining({ id: "TI14", severity: "block", path: CONFIG, line: null, detail: BINARY }),
    ]);

    const other = caseDiff("TI14/pass-binary-other-yaml");
    const yaml = entries(other).filter((e) => /\.ya?ml$/.test(e.path));
    expect(yaml.length, "a YAML entry").toBeGreaterThan(0);
    for (const entry of yaml) {
      expect(isBinary(entry), `${entry.path} is binary`).toBe(true);
      expect(entry.path, "not the config in use").not.toBe(CONFIG);
      expect(entry.oldPath, "not the config in use").not.toBe(CONFIG);
    }
    expect(signalsOf(await run(other, "block"), "TI14"), "no TI14").toEqual([]);
  });
});
