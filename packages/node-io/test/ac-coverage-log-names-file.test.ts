import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageChoiceLine } from "../../core/src/index.js";
import { listDir, readCoverageFiles, readFile, readFileStream } from "../src/index.js";

const fixture = (path: string) => readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8");
const LCOV = fixture("lcov/relative.info");

const deps = { listDir, readFile, readFileStream, resolvePath: resolve };

async function read(baseDir: string, entries: string | string[], format: "auto" | "lcov" = "auto") {
  const logged: string[] = [];
  const files = await readCoverageFiles(deps, {
    entries,
    label: "coverage-file",
    baseDir,
    format,
    repoRoot: baseDir,
    name: (entry) => entry,
    log: (line) => logged.push(line),
  });
  return { files, logged };
}

function withTree(build: (dir: string) => void, body: (dir: string) => Promise<void>) {
  // realpath: on macOS tmpdir() is behind a symlink.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-log-names-file-")));
  return (async () => {
    try {
      build(dir);
      await body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

describe("coverage format line names its file when several files are read", () => {
  it("coverageChoiceLine adds the file only when given one", () => {
    const choice = { format: "lcov", how: "auto-detected" } as const;
    expect(coverageChoiceLine(choice)).toBe("coverage: lcov (auto-detected)");
    expect(coverageChoiceLine(choice, "coverage/a.info")).toBe("coverage: coverage/a.info: lcov (auto-detected)");
  });

  it("a single file keeps the unnamed line, also when it is named twice or by a glob", async () => {
    await withTree(
      (dir) => {
        mkdirSync(join(dir, "coverage"));
        writeFileSync(join(dir, "coverage", "a.info"), LCOV);
      },
      async (dir) => {
        expect((await read(dir, "coverage/a.info")).logged).toEqual(["coverage: lcov (auto-detected)"]);
        expect((await read(dir, ["coverage/a.info", "./coverage/a.info"])).logged).toEqual([
          "coverage: lcov (auto-detected)",
        ]);
        expect((await read(dir, "coverage/*.info")).logged).toEqual(["coverage: lcov (auto-detected)"]);
        expect((await read(dir, "coverage/a.info", "lcov")).logged).toEqual(["coverage: lcov (configured)"]);
      },
    );
  });

  it("several files: one line each, naming the entry or the glob match, in read order", async () => {
    await withTree(
      (dir) => {
        mkdirSync(join(dir, "coverage"));
        writeFileSync(join(dir, "coverage", "a.info"), LCOV);
        writeFileSync(join(dir, "coverage", "b.info"), LCOV);
        writeFileSync(join(dir, "c.info"), LCOV);
      },
      async (dir) => {
        expect((await read(dir, ["c.info", "coverage/*.info"])).logged).toEqual([
          "coverage: c.info: lcov (auto-detected)",
          "coverage: coverage/a.info: lcov (auto-detected)",
          "coverage: coverage/b.info: lcov (auto-detected)",
        ]);
        expect((await read(dir, ["c.info", "coverage/a.info"], "lcov")).logged).toEqual([
          "coverage: c.info: lcov (configured)",
          "coverage: coverage/a.info: lcov (configured)",
        ]);
      },
    );
  });

  // O3: an explicit (literal) path is opened as given, so a symbolic link there is followed, also one that points
  // outside the base directory. A glob walk never follows a link. docs/LIMITS.md and docs/THREAT-MODEL.md say so.
  it("a literal path that is a symlink to a file outside the base is read; a glob never follows the link", async () => {
    await withTree(
      (dir) => {
        mkdirSync(join(dir, "repo"));
        mkdirSync(join(dir, "outside"));
        writeFileSync(join(dir, "outside", "real.info"), LCOV);
        symlinkSync(join(dir, "outside", "real.info"), join(dir, "repo", "link.info"), "file");
      },
      async (dir) => {
        const repo = join(dir, "repo");
        const literal = await read(repo, "link.info");
        expect(literal.logged).toEqual(["coverage: lcov (auto-detected)"]);
        expect(literal.files).toHaveLength(1);
        expect(literal.files[0]).toMatchObject({ file: "link.info", format: "lcov" });

        const globbed = await read(repo, "*.info");
        expect(globbed.logged).toEqual([]);
        expect(globbed.files).toEqual([{ missingFile: "*.info" }]);
      },
    );
  });
});
