import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The committed action dist must be a fresh bundle that carries the Python alias maps TI03 takes from the Python index
// (CORE-356: `ti03Aliases` replaced the hand-written import reader `pythonImportAliases`). (CORE-132: the comparisons of
// schema/, the message codes, the pinned regression tests, their digests, the ADDED_AFTER_BASE sets and the fixtures
// with an old commit, and the check of another test file's Skylos literal, were history pins and are removed.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MARKER = "ti03Aliases";

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

describe("pytest parity: dist freshness", () => {
  it("AC-20: the committed dist is a fresh bundle that carries the index-backed alias maps", () => {
    const committed = read("packages/action/dist/index.js");
    expect(committed, `the dist carries ${MARKER}`).toContain(MARKER);
    const out = mkdtempSync(join(tmpdir(), "pharn-ci-pyparity2-bundle-"));
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
