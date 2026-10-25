import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// corpus-run-script: a usage error in scripts/corpus-run.mjs exits 2 with the usage line before any git call, any
// cache directory or any output file. The spawned runs get a PATH holding only an empty directory, so git cannot run
// at all, and PHARN_CORPUS_CACHE points at a directory that must not be created. `--cli` names an existing stub so a
// missing CLI bundle is never the reported problem.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const USAGE = "usage: node scripts/corpus-run.mjs";

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pharn-corpus-run-usage-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CASES: { name: string; flags: string[]; names: string }[] = [
  { name: "an unknown option", flags: ["--nope", "x"], names: "--nope" },
  { name: "--jobs as the last argument with no value", flags: ["--jobs"], names: "--jobs" },
  { name: "--jobs 0", flags: ["--jobs", "0"], names: "--jobs" },
  { name: "--limit 0", flags: ["--limit", "0"], names: "--limit" },
  { name: "--limit 1.5", flags: ["--limit", "1.5"], names: "--limit" },
  { name: "--timeout -1", flags: ["--timeout", "-1"], names: "--timeout" },
  { name: "--timeout abc", flags: ["--timeout", "abc"], names: "--timeout" },
  { name: "a --repo that no corpus file names", flags: ["--repo", "nobody/nothing"], names: "nobody/nothing" },
];

describe("corpus-run-script: usage errors", () => {
  for (const { name, flags, names } of CASES) {
    it(`AC-6: ${name} exits 2 with the usage line and writes no output file and no cache directory`, () => {
      const dir = freshDir();
      const out = join(dir, "out.csv");
      const cache = join(dir, "cache");
      const envCache = join(dir, "envcache");
      const emptyBin = join(dir, "empty-bin");
      mkdirSync(emptyBin);
      const cli = join(dir, "cli-stub.mjs");
      writeFileSync(cli, "process.exit(0);\n");

      const result = spawnSync(
        process.execPath,
        ["scripts/corpus-run.mjs", "--cli", cli, "--cache", cache, "--out", out, ...flags],
        {
          cwd: ROOT,
          encoding: "utf8",
          env: { ...process.env, PATH: emptyBin, PHARN_CORPUS_CACHE: envCache },
          timeout: 60_000,
        },
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr, "stderr names the problem").toContain(names);
      expect(result.stderr, "stderr shows the usage line").toContain(USAGE);
      expect(existsSync(out), "no output file").toBe(false);
      expect(existsSync(cache), "no --cache directory").toBe(false);
      expect(existsSync(envCache), "no PHARN_CORPUS_CACHE directory").toBe(false);
    });
  }
});
