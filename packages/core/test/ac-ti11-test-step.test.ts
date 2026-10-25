import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI11 exists, so nothing the build
// adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CI = ".github/workflows/ci.yml";

function hunk(start: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${start - 1},0` : `${start},${removed.length}`;
  const newPart = added.length === 0 ? `${start - 1},0` : `${start},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, hunks: Array<[number, string[], string[]]>): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap(([start, removed, added]) => hunk(start, removed, added))].join("\n")}\n`;
}

function removeFile(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "deleted file mode 100644", "index 1111111..0000000 100644"];
  const body = [`--- a/${path}`, "+++ /dev/null", `@@ -1,${lines.length} +0,0 @@`, ...lines.map((l) => `-${l}`)];
  return `${[...head, ...body].join("\n")}\n`;
}

function addFile(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..2222222 100644"];
  const body = [`--- /dev/null`, `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)];
  return `${[...head, ...body].join("\n")}\n`;
}

function renameOnly(from: string, to: string): string {
  return `${[`diff --git a/${from} b/${to}`, "similarity index 100%", `rename from ${from}`, `rename to ${to}`].join(
    "\n",
  )}\n`;
}

async function run(diff: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti11 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI11");

describe("TI11: a test step removed from a workflow", () => {
  it("AC-6: a removed test command or a deleted workflow with one is a block finding; a comment, a move, a reflow and a rename are not", async () => {
    const removals: Array<[string, string]> = [
      ["pnpm test:coverage", "      - run: pnpm test:coverage"],
      ["npx vitest run", "        run: npx vitest run"],
      ["pytest", "      - run: pytest -q"],
      ["go test", "      - run: go test ./..."],
      ["a block scalar line", "          pnpm test"],
    ];
    for (const [label, line] of removals) {
      const signals = ti11(await run(edit(CI, [[14, [line], []]])));
      expect(signals, label).toHaveLength(1);
      expect(signals[0], label).toMatchObject({ severity: "block", path: CI, line: 14 });
      expect(signals[0]?.detail.length, label).toBeLessThanOrEqual(300);
      expect(signals[0]?.detail, label).not.toMatch(/pnpm|vitest|pytest|go test/);
    }

    const deletedPath = ".github/workflows/old.yml";
    const deleted = ti11(
      await run(
        removeFile(deletedPath, ["name: old", "on: push", "jobs:", "  t:", "    steps:", "      - run: pnpm test"]),
      ),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ severity: "block", path: deletedPath, line: 6 });

    const controls: Array<[string, string]> = [
      ["a removed comment", edit(CI, [[14, ["      # pnpm test"], []]])],
      [
        "a step moved to another workflow",
        edit(CI, [[14, ["      - run: pnpm test"], []]]) +
          addFile(".github/workflows/test.yml", [
            "name: test",
            "on: push",
            "jobs:",
            "  t:",
            "    steps:",
            "      - run: pnpm test",
          ]),
      ],
      ["a command reflowed", edit(CI, [[14, ["      - run: pnpm test"], ["      - run:   pnpm   test"]]])],
      ["a pure rename", renameOnly(CI, ".github/workflows/main.yml")],
    ];
    for (const [label, diff] of controls) {
      expect(ti11(await run(diff)), label).toEqual([]);
    }
  });
});
