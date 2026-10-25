import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// precision-corpus-freeze: scripts/corpus-freeze.mjs is a dev-only maintainer script. Importing it runs nothing;
// running it with a missing or bad flag exits 2 with a usage message before any GitHub call. The spawned runs get
// a PATH holding only an empty directory, so even a script that tried to run `gh` could not reach the network.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT_PATH = `${ROOT}scripts/corpus-freeze.mjs`;

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "corpus-freeze-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const run = (flags: string[]) =>
  spawnSync(process.execPath, ["scripts/corpus-freeze.mjs", ...flags], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: freshDir() },
  });

const validFlags = (out: string) => ({
  repo: ["--repo", "example/repo"],
  frozenAt: ["--frozen-at", "2026-10-25T00:00:00Z"],
  count: ["--count", "200"],
  out: ["--out", out],
  monorepo: ["--monorepo", "false"],
});

describe("precision-corpus-freeze: the maintainer script's entry point", () => {
  it("AC-8: importing the script returns its exported functions without exiting the process", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)}) called on import`);
    });
    const mod = await import(pathToFileURL(SCRIPT_PATH).href);
    for (const name of ["isBot", "isRelease", "buildDocument", "shouldStopPaging"]) {
      expect(typeof mod[name], name).toBe("function");
    }
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("AC-8: a run without --repo exits 2 with a usage message naming --repo and writes no file", () => {
    const out = join(freshDir(), "out.json");
    const f = validFlags(out);
    const result = run([...f.frozenAt, ...f.count, ...f.out, ...f.monorepo]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--repo");
    expect(existsSync(out)).toBe(false);
  });

  it("AC-8: a run with --monorepo maybe exits 2 with a usage message naming --monorepo and writes no file", () => {
    const out = join(freshDir(), "out.json");
    const f = validFlags(out);
    const result = run([...f.repo, ...f.frozenAt, ...f.count, ...f.out, "--monorepo", "maybe"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--monorepo");
    expect(existsSync(out)).toBe(false);
  });

  it("AC-8: a run with a --frozen-at that is not an ISO 8601 timestamp exits 2 naming --frozen-at and writes no file", () => {
    const out = join(freshDir(), "out.json");
    const f = validFlags(out);
    const result = run([...f.repo, "--frozen-at", "2026-10-25", ...f.count, ...f.out, ...f.monorepo]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--frozen-at");
    expect(existsSync(out)).toBe(false);
  });

  it("AC-8: the header comment says it is a dev-only maintainer script, never part of the Action or the CLI", () => {
    const lines = readFileSync(SCRIPT_PATH, "utf8").split("\n");
    const header: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#!")) {
        if (header.length === 0) continue;
        break;
      }
      if (!/^(\/\/|\/\*|\*)/.test(trimmed)) break;
      header.push(trimmed.replace(/^(\/\/+|\/\*+|\*\/|\*)\s?/, "").replace(/\*\/$/, ""));
    }
    expect(header.length).toBeGreaterThan(0);
    const text = header.join(" ").replace(/\s+/g, " ");
    expect(text).toContain("dev-only maintainer script");
    expect(text).toContain("never part of the Action or the CLI");
  });
});
