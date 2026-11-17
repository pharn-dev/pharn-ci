// CORE-147: the `Action pins` script (scripts/check-action-pins.mjs) must report a `uses` key that has no value on
// its own line (the value on the next line, only a comment after it, or a flow mapping split after the key), whatever
// the next line holds, and must still not read a key out of a block scalar.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(REPO, "scripts", "check-action-pins.mjs");
const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const MESSAGE = "uses: with no value on its line";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the pins script in a temp dir that holds `.github/workflows/x.yml` with `workflow` as its text. */
function runPins(workflow: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "pharn-pins-"));
  temps.push(dir);
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "x.yml"), workflow);
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const steps = (...lines: string[]) => `jobs:\n  a:\n    steps:\n${lines.map((line) => `      ${line}\n`).join("")}`;
const X = join(".github", "workflows", "x.yml");

describe("CORE-147: Action pins reports a uses key with no value on its line", () => {
  it("AC-1: names line 4 for a bare `- uses:` with the ref on the next line, tag or 40-hex SHA alike", () => {
    const tag = runPins(steps("- uses:", "  actions/checkout@v4"));
    expect(tag.status).toBe(1);
    expect(tag.stderr).toContain(`${X}:4  ${MESSAGE}`);

    const pinned = runPins(steps("- uses:", `  actions/checkout@${SHA}`));
    expect(pinned.status).toBe(1);
    expect(pinned.stderr).toContain(`${X}:4  ${MESSAGE}`);
  });

  it("AC-2: reports `- uses: # note` and still passes block-scalar text that ends in `uses:`", () => {
    const comment = runPins(steps("- uses: # note"));
    expect(comment.status).toBe(1);
    expect(comment.stderr).toContain(MESSAGE);

    const block = runPins(steps("- run: |", "    echo uses:"));
    expect(block.stderr).toBe("");
    expect(block.status).toBe(0);
    expect(block.stdout).toContain("ok   every workflow action is pinned to a commit SHA");
  });

  it("AC-3: reports a flow mapping split so that the uses key ends its line", () => {
    const run = runPins(steps("- { name: x, uses:", "  actions/checkout@v4 }"));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(MESSAGE);
  });
});
