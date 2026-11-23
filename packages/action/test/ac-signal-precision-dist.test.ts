import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The committed action dist must carry this change's code (the TI09 project matcher, the TI06 expect-subject reader
// and the TI11 `run-script` key), and so must a fresh bundle of the action entry point made with scripts/bundle.mjs
// into a temp directory (as the earlier dist tests make it). The files are read inside the test body. (CORE-132: the
// comparison of every package.json with an old commit was a history pin and is removed.)

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const MARKERS = ["compareProjects", "readEqualityCalls", '"run-script"'];

describe("the action dist carries this change's code", () => {
  it("AC-14: the committed packages/action/dist/index.js and a fresh bundle of packages/action/src/index.ts contain this change's code", () => {
    const committed = readFileSync(join(REPO, "packages/action/dist/index.js"), "utf8");
    for (const marker of MARKERS)
      expect(committed.includes(marker), `the committed dist contains ${marker}`).toBe(true);

    const out = mkdtempSync(join(tmpdir(), "pharn-ci-signal-precision-bundle-"));
    try {
      const outfile = join(out, "action.js");
      execFileSync(
        process.execPath,
        [join(REPO, "scripts/bundle.mjs"), join(REPO, "packages/action/src/index.ts"), outfile],
        { cwd: REPO },
      );
      const fresh = readFileSync(outfile, "utf8");
      for (const marker of MARKERS)
        expect(fresh.includes(marker), `a fresh action bundle contains ${marker}`).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
