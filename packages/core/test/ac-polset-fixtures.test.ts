import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-32. The tree, fixtures/policy-settings/ and the AC test files are read inside the
// test body, and findSecretSpans() is loaded there: the build adds the fixtures after this test is written. The base is
// main at 93376a9 (E3 item 22 merged), read with git.

const BASE = "93376a9";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const AGENT_SETTINGS =
  /(?:^|\/)(?:\.claude\/settings\.json|\.claude\/settings\.local\.json|\.mcp\.json|\.cursor\/mcp\.json|\.vscode\/mcp\.json)$/;
const FIXTURES = "fixtures/policy-settings";

/** Every file under `dir` (repo-relative), recursively. */
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}

describe("the fixtures of E3 item 23", () => {
  it("AC-32: no new agent-settings path in the tree, a must-trigger and a must-not-trigger case with files.json for each of P02–P06, and no secret-shaped value in a new fixture or test", async () => {
    // The tree after the increment: tracked and untracked, ignored files left out.
    const now = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
      .split("\0")
      .filter((p) => p !== "");
    const before = new Set(
      git("ls-tree", "-r", "--name-only", "-z", BASE)
        .split("\0")
        .filter((p) => p !== ""),
    );
    expect(now.length).toBeGreaterThan(0);
    expect(
      now.filter((p) => AGENT_SETTINGS.test(p) && !before.has(p)),
      "no new path ends in an agent settings or MCP file name",
    ).toEqual([]);

    // A must-trigger (violates-*) and a must-not-trigger (complies-*) case for each rule, each with a files.json.
    expect(existsSync(join(ROOT, FIXTURES)), `${FIXTURES} exists`).toBe(true);
    for (const rule of ["p02", "p03", "p04", "p05", "p06"]) {
      const dir = `${FIXTURES}/${rule}`;
      expect(existsSync(join(ROOT, dir)), `${dir} exists`).toBe(true);
      const cases = readdirSync(join(ROOT, dir)).filter((name) => statSync(join(ROOT, dir, name)).isDirectory());
      for (const kind of ["violates-", "complies-"]) {
        const named = cases.filter((c) => c.startsWith(kind));
        expect(named.length, `${dir}: a ${kind}* case`).toBeGreaterThan(0);
        for (const c of named) {
          const map = JSON.parse(readFileSync(join(ROOT, dir, c, "files.json"), "utf8")) as Record<string, string>;
          expect(Object.keys(map).length, `${dir}/${c}/files.json maps a path`).toBeGreaterThan(0);
          for (const name of Object.values(map)) {
            expect(existsSync(join(ROOT, dir, c, name)), `${dir}/${c}/${name} exists`).toBe(true);
            expect(AGENT_SETTINGS.test(`${dir}/${c}/${name}`), `${name} is not an agent settings name`).toBe(false);
          }
        }
      }
    }

    // No secret-shaped value in a new fixture or in this increment's AC tests.
    const { findSecretSpans } = (await import("@pharn-ci/core")) as unknown as {
      findSecretSpans(text: string): { id: string; start: number; end: number }[];
    };
    const tests = ["packages/core/test", "packages/cli/test", "packages/action/test"].flatMap((dir) =>
      readdirSync(join(ROOT, dir))
        .filter((name) => /^ac-polset-.*\.test\.ts$/.test(name))
        .map((name) => `${dir}/${name}`),
    );
    expect(tests.length, "the AC test files").toBe(32);
    for (const path of [...walk(FIXTURES), ...tests]) {
      const spans = findSecretSpans(readFileSync(join(ROOT, path), "utf8"));
      expect(
        spans.map((s) => s.id),
        `${path} holds no secret-shaped value`,
      ).toEqual([]);
    }
  });
});
