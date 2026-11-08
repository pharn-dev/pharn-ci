import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JUNIT_MAX_TOTAL_BYTES } from "../../core/src/index.js";
import { listDir, readFile, readFileStream } from "../src/io.js";
import { readJunitFiles } from "../src/junit.js";

// Flaky tests (A6): readJunitFiles over a real temporary directory. Patterns are checked like exclusions, symbolic links
// are never followed, files are taken in pattern order (each pattern's sorted), and the caps stop reading.

let dir: string;
const deps = {
  listDir,
  readFile,
  readFileStream,
  resolvePath: (...segments: string[]) => resolve(...segments),
};
const read = (patterns: string[]) => readJunitFiles(deps, { patterns, label: "junit-paths", baseDir: dir });

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-junit-io-")));
  mkdirSync(join(dir, "reports/unit"), { recursive: true });
  mkdirSync(join(dir, "outside"));
  writeFileSync(join(dir, "reports/unit/b.xml"), "<testsuite/>");
  writeFileSync(join(dir, "reports/unit/a.xml"), "<testsuites/>");
  writeFileSync(join(dir, "reports/e2e.xml"), "<testsuite name='e2e'/>");
  writeFileSync(join(dir, "outside/secret.xml"), "<testsuite name='secret'/>");
  symlinkSync(join(dir, "outside/secret.xml"), join(dir, "reports/linked.xml"));
  symlinkSync(join(dir, "outside"), join(dir, "reports/linked-dir"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readJunitFiles", () => {
  it("reads the matches in pattern order, each once, and skips symbolic links", async () => {
    const sources = await read(["reports/**/*.xml", "reports/unit/a.xml"]);
    expect(sources).toEqual({
      files: [
        { path: "reports/e2e.xml", text: "<testsuite name='e2e'/>" },
        { path: "reports/unit/a.xml", text: "<testsuites/>" },
        { path: "reports/unit/b.xml", text: "<testsuite/>" },
      ],
    });
    expect(await read(["reports/linked.xml", "reports/linked-dir/*.xml"])).toEqual({ files: [] });
  });

  it("refuses a pattern outside the base directory or one the matcher does not support", async () => {
    await expect(read(["../x.xml"])).rejects.toThrow('junit-paths "../x.xml" must not contain a ".." segment');
    await expect(read(["/etc/x.xml"])).rejects.toThrow('must not start with "/"');
    await expect(read(["reports/{a,b}.xml"])).rejects.toThrow('must not contain "{"');
  });

  it("drops the file that goes past 25 MiB unread to its end, and every later one", async () => {
    mkdirSync(join(dir, "big"));
    writeFileSync(join(dir, "big/a.xml"), "x".repeat(JUNIT_MAX_TOTAL_BYTES - 10));
    writeFileSync(join(dir, "big/b.xml"), "y".repeat(100));
    writeFileSync(join(dir, "big/c.xml"), "<testsuite/>");
    const sources = await read(["big/*.xml"]);
    expect(sources.files.map((f) => ("dropped" in f ? [f.path, f.dropped] : [f.path, "text"]))).toEqual([
      ["big/a.xml", "text"],
      ["big/b.xml", "byte-cap"],
      ["big/c.xml", "byte-cap"],
    ]);
    rmSync(join(dir, "big"), { recursive: true, force: true });
  });

  it("drops the files past the first 50 unread", async () => {
    mkdirSync(join(dir, "many"));
    for (let i = 0; i < 52; i++) writeFileSync(join(dir, `many/${String(i).padStart(2, "0")}.xml`), "<testsuite/>");
    const sources = await read(["many/*.xml"]);
    expect(sources.files).toHaveLength(52);
    expect(sources.files.slice(50)).toEqual([
      { path: "many/50.xml", dropped: "file-cap" },
      { path: "many/51.xml", dropped: "file-cap" },
    ]);
    rmSync(join(dir, "many"), { recursive: true, force: true });
  });
});
