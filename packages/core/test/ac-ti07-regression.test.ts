import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// git runs inside each test body over this increment's own change: from the base commit d73684d to the working tree
// before it is committed, then the commit that added this file (CI checks out the full history). The AC tests are
// written before the increment's deliberate test updates and the rebuilt dist exist.
//
// What may change in the existing tests: exactly the pinned tests the SPEC's Assumptions list, never a deletion or a
// rename of an existing test file, and no `.skip`, `.todo`, `.only` or skipIf added to them. What must change: the
// committed packages/action/dist/index.js, rebuilt so it carries TI07 (the existing dist tests then pass against it).

const BASE = "d73684d7b8c7841e28611758dd510f06aea35335";
const ROOT = new URL("../", `file://${FIXTURES}`).pathname;
const DIST = "packages/action/dist/index.js";

/** The existing tests the SPEC's Assumptions allow this increment to update. */
const ALLOWED = [
  "packages/core/test/ac-py-index-docs.test.ts",
  "packages/core/test/ac-skylos-nine-misses.test.ts",
  "packages/core/test/ac-skylos-nine-table.test.ts",
  "packages/core/test/ac-test-sources-docs.test.ts",
  "packages/core/test/ac-ti0205-skylos.test.ts",
  "packages/core/test/ac-ti081516-docs.test.ts",
  "packages/core/test/ac-v020-limits.test.ts",
  "packages/core/test/ac-v020-readme.test.ts",
  "packages/core/test/ac-v020-skylos-count.test.ts",
];

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const SELF = "packages/core/test/ac-ti07-regression.test.ts";

/**
 * The revisions this increment's change spans: from the base commit to the working tree while this file is not
 * committed yet, and once it is, from the parent of the commit that added it to that commit. So the check always reads
 * this increment's own change, never a later change on main (which may update other tests on purpose).
 */
function changeRange(): string[] {
  const added = git("log", "--diff-filter=A", "--format=%H", "-1", "--", SELF).trim();
  return added === "" ? [BASE] : [`${added}^`, added];
}

/** `git diff --name-status` over the change, as { status, path } with the old path for renames. */
function changedSince(): Array<{ status: string; path: string; oldPath: string }> {
  return git("diff", "--name-status", "--no-renames", ...changeRange(), "--", "packages")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status: (status ?? "").charAt(0), path: paths.at(-1) ?? "", oldPath: paths[0] ?? "" };
    });
}

const isTestDirFile = (path: string) => /^packages\/[^/]+\/test\//.test(path);

describe("the existing suite stays whole", () => {
  it("AC-16: only the listed pinned tests changed, none was deleted or renamed, none gained a skip, todo or only, and the committed action dist is rebuilt with TI07", () => {
    const changed = changedSince();
    const existingTests = changed.filter((c) => isTestDirFile(c.oldPath) && c.status !== "A");

    expect(
      existingTests.filter((c) => c.status === "D"),
      "no existing test file is deleted",
    ).toEqual([]);
    const modified = existingTests.filter((c) => c.status === "M").map((c) => c.path);
    for (const path of modified) expect(ALLOWED, `${path} may be updated`).toContain(path);
    expect(
      existingTests.filter((c) => !["M", "D"].includes(c.status)),
      "no other change to an existing test file",
    ).toEqual([]);

    for (const path of modified) {
      const added = git("diff", "--unified=0", ...changeRange(), "--", path)
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
      for (const line of added) {
        // A test or group declared skipped, todo, only or conditional; text that only mentions such a call inside a
        // string (a doc test quoting `it.skip(`) does not start the line with it.
        expect(line, `${path}: no skip, todo or only added`).not.toMatch(
          /^\+\s*(it|test|describe|suite)\.(skip|todo|only|skipIf|runIf)\b|^\+\s*(xit|xdescribe|xtest|fit|fdescribe)\(/,
        );
      }
    }

    expect(
      changed.some((c) => c.path === DIST && c.status === "M"),
      "the committed action dist is rebuilt",
    ).toBe(true);
    const dist = readFileSync(`${ROOT}${DIST}`, "utf8");
    expect(dist, "the rebuilt dist carries TI07").toContain("TEST_INTEGRITY_TI07");
  });
});
