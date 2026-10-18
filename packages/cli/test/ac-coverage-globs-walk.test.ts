import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// main(), nodeDeps() and the fixtures are loaded inside the test body: the AC test is written before coverage globs
// and fixtures/coverage-multi/ exist, so nothing that depends on them may run while the file loads. The test builds a
// real directory tree with symbolic links in a temp directory, inside the test body, and removes it at the end. The
// filesystem is real (nodeDeps' readFile and listDir); only git is faked, returning the golden diff and files list.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const GUID = "6f1c2b9e-3d4a-4c8e-9b7f-0a1e2d3c4b5a";
const SHA = "1111111111111111111111111111111111111111";
const TIMEOUT_MS = 120_000;

/**
 * TestResults/<GUID>/coverage.cobertura.xml, the one file the walk may read; TestResults/linked, a symbolic link to a
 * directory outside TestResults holding another coverage.cobertura.xml; TestResults/link.cobertura.xml, a symbolic
 * link to a coverage file; and matching files under TestResults/node_modules/ and TestResults/.git/.
 */
function makeTree() {
  // realpath: on macOS tmpdir() is behind a symlink.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-coverage-globs-")));
  const coverlet = fixture(`coverage-multi/coverlet/TestResults/${GUID}/coverage.cobertura.xml`);
  mkdirSync(join(dir, "TestResults", GUID), { recursive: true });
  writeFileSync(join(dir, "TestResults", GUID, "coverage.cobertura.xml"), coverlet);
  mkdirSync(join(dir, "outside"));
  writeFileSync(join(dir, "outside", "coverage.cobertura.xml"), coverlet);
  writeFileSync(join(dir, "outside", "target.xml"), coverlet);
  symlinkSync(join(dir, "outside"), join(dir, "TestResults", "linked"), "dir");
  symlinkSync(join(dir, "outside", "target.xml"), join(dir, "TestResults", "link.cobertura.xml"), "file");
  mkdirSync(join(dir, "TestResults", "node_modules"));
  writeFileSync(join(dir, "TestResults", "node_modules", "dep.cobertura.xml"), coverlet);
  mkdirSync(join(dir, "TestResults", ".git"));
  writeFileSync(join(dir, "TestResults", ".git", "git.cobertura.xml"), coverlet);
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runCli(dir: string, argv: string[]) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(dir);
  const reads: string[] = [];
  let out = "";
  let err = "";
  const realReadFile = deps.readFile;
  deps.readFile = async (path: string) => {
    reads.push(path);
    return realReadFile.call(deps, path);
  };
  deps.git = async (args: string[]) => {
    if (args.includes("ls-files")) {
      const paths = fixture("golden/files.txt").trim().split("\n");
      return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
    }
    if (args.includes("--show-toplevel")) return `${dir}\n`;
    if (args.includes("diff")) return fixture("golden/pr.diff");
    return `${SHA}\n`;
  };
  deps.stdout = (text: string) => {
    out += text;
  };
  deps.stderr = (text: string) => {
    err += text;
  };
  const code = await main(argv, deps);
  return {
    code,
    stdout: out,
    stderr: err,
    coverageReads: reads.filter((path) => path.endsWith(".xml")),
    formatLines: err.split("\n").filter((line) => line.startsWith("coverage: ")),
  };
}

describe("pharn-ci check: the glob walk on a real directory tree", () => {
  it(
    "AC-15: the walk follows no symbolic link and skips node_modules and .git unless the pattern names them",
    async () => {
      const { EXIT_ERROR } = await import("../src/main.js");
      const tree = makeTree();
      try {
        const globstar = await runCli(tree.dir, [
          "check",
          "--coverage",
          "TestResults/**/*.cobertura.xml",
          "--format",
          "json",
        ]);
        expect(globstar.code, globstar.stderr).not.toBe(EXIT_ERROR);
        expect(globstar.formatLines).toEqual(["coverage: cobertura (auto-detected)"]);
        expect(globstar.coverageReads).toEqual([join(tree.dir, "TestResults", GUID, "coverage.cobertura.xml")]);

        const named = await runCli(tree.dir, [
          "check",
          "--coverage",
          "TestResults/node_modules/*.cobertura.xml",
          "--format",
          "json",
        ]);
        expect(named.code, named.stderr).not.toBe(EXIT_ERROR);
        expect(named.formatLines).toEqual(["coverage: cobertura (auto-detected)"]);
        expect(named.coverageReads).toEqual([join(tree.dir, "TestResults", "node_modules", "dep.cobertura.xml")]);
      } finally {
        tree.remove();
      }
    },
    TIMEOUT_MS,
  );
});
