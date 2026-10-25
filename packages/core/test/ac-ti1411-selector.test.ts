import { describe, expect, it } from "vitest";

// The selector and the parser are loaded inside the test body: the AC tests are written before the selector exists,
// so nothing the build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function hunk(start: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${start - 1},0` : `${start},${removed.length}`;
  const newPart = added.length === 0 ? `${start - 1},0` : `${start},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

/** A modified file, one hunk per [start, removed, added] entry, as `git diff --unified=0` writes it. */
function edit(path: string, hunks: Array<[number, string[], string[]]>): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap(([start, removed, added]) => hunk(start, removed, added))].join("\n")}\n`;
}

const DIFF = [
  edit(".pharn/ci.yml", [[3, ["  threshold: 80"], ["  threshold: 70"]]]),
  edit(".github/workflows/ci.yml", [[9, ["      - run: pnpm test"], []]]),
  edit(".github/workflows/x.yaml", [[2, [], ["  continue-on-error: true"]]]),
  edit("src/app.ts", [[1, [], ["export const a = 1;"]]]),
  edit(".github/dependabot.yml", [[4, [], ["    interval: weekly"]]]),
  edit("config/pharn.yml", [[3, ["  threshold: 80"], ["  threshold: 60"]]]),
  edit("src/a.test.ts", [[2, ["it('x', () => {});"], []]]),
].join("");

describe("keepSignalFileText(): which files keep their line text", () => {
  it("AC-1: the config in use, the workflow files and the test files keep text, nothing else does", async () => {
    const { keepSignalFileText } = await import("../src/signals/signalFiles.js");
    const { parseUnifiedDiff } = await import("../src/diff/unified.js");

    const kept = (predicate: (file: { path: string; oldPath: string }) => boolean) =>
      parseUnifiedDiff(DIFF, { keepText: predicate })
        .filter((file) => file.hunks !== undefined)
        .map((file) => file.path)
        .sort(byCodeUnit);

    // src/app.ts is a JS/TS source file, whose text is kept since TI10 and TI13.
    const common = [".github/workflows/ci.yml", ".github/workflows/x.yaml", "src/a.test.ts", "src/app.ts"];

    // Default config path: .pharn/ci.yml is selected, config/pharn.yml is not.
    expect(kept(keepSignalFileText())).toEqual([...common, ".pharn/ci.yml"].sort(byCodeUnit));

    // A custom config path replaces the default one.
    expect(kept(keepSignalFileText("config/pharn.yml", REPO_ROOT))).toEqual(
      [...common, "config/pharn.yml"].sort(byCodeUnit),
    );
    expect(kept(keepSignalFileText(`${REPO_ROOT}/config/pharn.yml`, REPO_ROOT))).toEqual(
      [...common, "config/pharn.yml"].sort(byCodeUnit),
    );

    // A config outside the repository selects no config file at all.
    expect(kept(keepSignalFileText("/elsewhere/pharn.yml", REPO_ROOT))).toEqual(common);

    // Selected files carry the text of their added and removed lines; the others carry none.
    const files = parseUnifiedDiff(DIFF, { keepText: keepSignalFileText() });
    const config = files.find((file) => file.path === ".pharn/ci.yml");
    expect(config?.hunks?.[0]?.added[0]).toEqual({ line: 3, text: "  threshold: 70" });
    expect(config?.hunks?.[0]?.removed[0]).toEqual({ line: 3, text: "  threshold: 80" });
    expect(files.find((file) => file.path === "src/app.ts")?.hunks?.[0]?.added[0]).toEqual({
      line: 1,
      text: "export const a = 1;",
    });
    for (const path of [".github/dependabot.yml", "config/pharn.yml"]) {
      expect(files.find((file) => file.path === path)?.hunks, path).toBeUndefined();
    }
  });
});
