import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The committed action dist is read, and a fresh bundle of packages/action/src/index.ts is made with
// scripts/bundle.mjs into a temp directory, inside the test body: the AC test is written before the build rebuilds the
// dist with TI01's new same-stem details. The freshness check is the one CI runs in spirit (`pnpm build`, then no diff
// under packages/action/dist): the committed dist must be byte-identical to a fresh bundle of the sources.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DETAILS = [
  "Test file replaced by a test file of the same name; every test it held is found again, by body, in a new test of this change.",
  "Test file deleted; a test file of the same name was added, but not every test it held is found again by body.",
  "Test file deleted; a test file of the same name was added, but the text to compare their tests was not available.",
];

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

describe("the committed action dist carries the same-stem details and is fresh", () => {
  it("AC-11: packages/action/dist/index.js holds the three TI01 same-stem detail sentences and is byte-identical to a fresh bundle of packages/action/src/index.ts", () => {
    const committed = readFileSync(join(ROOT, "packages/action/dist/index.js"), "utf8");
    for (const detail of DETAILS) expect(committed.includes(detail), `the dist holds "${detail}"`).toBe(true);

    const out = mkdtempSync(join(tmpdir(), "pharn-ci-name-only-bundle-"));
    try {
      const outfile = join(out, "index.js");
      execFileSync(process.execPath, ["../../scripts/bundle.mjs", "src/index.ts", outfile], {
        cwd: join(ROOT, "packages/action"),
      });
      expect(sha256(committed), "the committed dist is a fresh bundle").toBe(sha256(readFileSync(outfile, "utf8")));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
