import { describe, expect, it } from "vitest";

// The core entry point and the diff parser are loaded inside the test body: the AC test is written before
// isSnapFile exists and before the read plan drops snapshot paths, so nothing that depends on them may run while the
// file loads. The diff is written here, in `git diff` shape, so every status is known.

type Select = (diff: readonly unknown[]) => { base: string[]; head: string[] };

const DIFF = [
  "diff --git a/test/__snapshots__/m.test.ts.snap b/test/__snapshots__/m.test.ts.snap",
  "index 1111111..2222222 100644",
  "--- a/test/__snapshots__/m.test.ts.snap",
  "+++ b/test/__snapshots__/m.test.ts.snap",
  "@@ -2 +2 @@",
  '-exports[`m 1`] = `"old"`;',
  '+exports[`m 1`] = `"new"`;',
  "diff --git a/test/__snapshots__/n.test.ts.snap b/test/__snapshots__/n.test.ts.snap",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/test/__snapshots__/n.test.ts.snap",
  "@@ -0,0 +1 @@",
  '+exports[`n 1`] = `"n"`;',
  "diff --git a/test/__snapshots__/d.test.ts.snap b/test/__snapshots__/d.test.ts.snap",
  "deleted file mode 100644",
  "index 4444444..0000000",
  "--- a/test/__snapshots__/d.test.ts.snap",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  '-exports[`d 1`] = `"d"`;',
  "diff --git a/test/__snapshots__/r-old.test.ts.snap b/test/__snapshots__/r-new.test.ts.snap",
  "similarity index 90%",
  "rename from test/__snapshots__/r-old.test.ts.snap",
  "rename to test/__snapshots__/r-new.test.ts.snap",
  "index 5555555..6666666 100644",
  "--- a/test/__snapshots__/r-old.test.ts.snap",
  "+++ b/test/__snapshots__/r-new.test.ts.snap",
  "@@ -2 +2 @@",
  '-exports[`r 1`] = `"a"`;',
  '+exports[`r 1`] = `"b"`;',
  "diff --git a/test/a.test.ts b/test/a.test.ts",
  "index 7777777..8888888 100644",
  "--- a/test/a.test.ts",
  "+++ b/test/a.test.ts",
  "@@ -3 +3 @@",
  '-  expect(a()).toBe("old");',
  '+  expect(a()).toBe("new");',
  "",
].join("\n");

describe("test sources: snapshot files are not read", () => {
  it("AC-12: the read plan selects no .snap path on either side for a modified, added, deleted and renamed snapshot, keeps the .test.ts file on both, and isSnapFile is true only for a.test.ts.snap", async () => {
    const { parseUnifiedDiff } = await import("../src/diff/unified.js");
    const core = (await import("../src/index.js")) as unknown as {
      selectTestSourcePaths: Select;
      isSnapFile: (path: string) => boolean;
    };
    const diff = parseUnifiedDiff(DIFF) as unknown as Array<{ path: string; oldPath: string; status: string }>;
    expect(diff.map((f) => f.status).sort(), "the diff holds every status").toEqual([
      "added",
      "deleted",
      "modified",
      "modified",
      "renamed",
    ]);

    const { base, head } = core.selectTestSourcePaths(diff);
    expect(
      base.filter((p) => p.endsWith(".snap")),
      "no .snap path on the base side",
    ).toEqual([]);
    expect(
      head.filter((p) => p.endsWith(".snap")),
      "no .snap path on the head side",
    ).toEqual([]);
    expect(base).toContain("test/a.test.ts");
    expect(head).toContain("test/a.test.ts");

    expect(typeof core.isSnapFile, "isSnapFile is exported from the core entry point").toBe("function");
    expect(core.isSnapFile("a.test.ts.snap")).toBe(true);
    expect(core.isSnapFile("a.test.ts")).toBe(false);
    expect(core.isSnapFile("snap.test.ts")).toBe(false);
  }, 60_000);
});
