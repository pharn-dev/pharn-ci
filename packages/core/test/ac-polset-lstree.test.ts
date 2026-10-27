import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-6. parseLsTreeSymlinks() is loaded inside the test body: the AC test is written
// before the build adds it, so nothing the build adds may run while this file loads.

type Parse = (text: string) => Set<string>;

const OID = "e".repeat(40);
const record = (mode: string, type: string, size: string, path: string) => `${mode} ${type} ${OID} ${size}\t${path}\0`;

describe("parseLsTreeSymlinks", () => {
  it("AC-6: returns exactly the symlink paths of git ls-tree -r -l -z output, verbatim, skipping a malformed record without throwing", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as { parseLsTreeSymlinks: Parse };
    expect(typeof core.parseLsTreeSymlinks, "parseLsTreeSymlinks is exported").toBe("function");

    const text = [
      record("100644", "blob", "12", "README.md"),
      record("100755", "blob", "30", "scripts/run.sh"),
      record("120000", "blob", "9", ".claude/settings.json"),
      record("160000", "commit", "-", "vendor/sub"),
      record("120000", "blob", "7", "dir with space/link name"),
      "garbage-without-a-tab\0",
      `120000 blob\tbad/meta\0`,
      record("100644", "blob", "5", "pkg/.claude/settings.local.json"),
    ].join("");

    let result: Set<string> | undefined;
    expect(() => {
      result = core.parseLsTreeSymlinks(text);
    }).not.toThrow();
    expect(result).toBeInstanceOf(Set);
    expect([...(result as Set<string>)].sort()).toEqual([".claude/settings.json", "dir with space/link name"]);

    for (const hostile of ["", "\0", "\t\0", "120000", `120000 blob ${OID} 9\t\0`, "a\tb\0c d e f\tg"]) {
      let parsed: Set<string> | undefined;
      expect(() => {
        parsed = core.parseLsTreeSymlinks(hostile);
      }, JSON.stringify(hostile)).not.toThrow();
      expect([...(parsed as Set<string>)], JSON.stringify(hostile)).toEqual([]);
    }
  });
});
