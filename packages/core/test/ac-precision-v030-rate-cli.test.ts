import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: the command docs/PRECISION.md names to reproduce the block table runs on the committed CSV, exits 0
// and prints 600 PRs, 0 errors and a 0.2 % ships-as-block line for TI01, TI02 and TI11.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("node scripts/corpus-rate.mjs fixtures/corpus/review.csv", () => {
  it("AC-3: exits 0 and prints PRs: 600 (errors: 0) and a | 0.2 % | ships as block | line for TI01, TI02 and TI11", () => {
    const run = spawnSync(process.execPath, ["scripts/corpus-rate.mjs", "fixtures/corpus/review.csv"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(run.status, `stderr: ${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("PRs: 600 (errors: 0)");
    const lines = run.stdout.split("\n").map((line) => line.replace(/\r$/, "").trimEnd());
    for (const id of ["TI01", "TI02", "TI11"]) {
      const line = lines.find((l) => l.startsWith(`| ${id} |`));
      expect(line, `a table line for ${id}`).toBeDefined();
      expect((line as string).endsWith("| 0.2 % | ships as block |"), `${id}: ${line}`).toBe(true);
    }
  });
});
