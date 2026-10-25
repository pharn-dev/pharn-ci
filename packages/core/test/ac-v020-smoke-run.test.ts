import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-readiness-v020: `node scripts/smoke-release.mjs .` passes on the committed packages/action/dist bundle,
// prints one `ok` line and leaves its temporary directory (under TMPDIR) empty. Needs git; no token, no network.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = "scripts/smoke-release.mjs";

describe("release-readiness-v020: release smoke on the committed bundle", () => {
  it("AC-11: node scripts/smoke-release.mjs . exits 0, prints exactly one non-blank line starting ok, and leaves TMPDIR empty", () => {
    expect(existsSync(join(ROOT, SCRIPT)), SCRIPT).toBe(true);
    const tmp = mkdtempSync(join(tmpdir(), "ac-v020-smoke-run-"));
    try {
      const run = spawnSync(process.execPath, [SCRIPT, "."], {
        cwd: ROOT,
        env: { ...process.env, TMPDIR: tmp },
        encoding: "utf8",
        timeout: 110_000,
      });
      const output = `${run.stdout}\n${run.stderr}`;
      expect(run.status, output).toBe(0);
      const stdout = run.stdout.split("\n").filter((line) => line.trim() !== "");
      expect(stdout, output).toHaveLength(1);
      expect(stdout[0]?.startsWith("ok"), output).toBe(true);
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
