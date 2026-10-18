import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// main() and the fixtures are loaded inside each test body: the AC tests are written before coverage globs and
// fixtures/golden-multi/ and fixtures/coverage-multi/ exist, so nothing that depends on them may run while the file
// loads. The CLI runs against in-memory deps: a fake repo rooted at REPO_ROOT whose git returns a fixture diff and
// files list, whose readFile reads a fake file tree, and whose listDir lists that tree by absolute path.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";

type DirEntry = { name: string; kind: "file" | "directory" | "symlink" | "other" };

interface RepoOptions {
  /** Repo-relative path -> file content. Directories are implied by the paths. */
  files: Record<string, string>;
  /** The fixture directory holding pr.diff and files.txt for git. */
  gitFixtures?: string;
  cwd?: string;
  /** Overrides the listing of one absolute directory. */
  listings?: Record<string, DirEntry[]>;
}

function fakeRepo(options: RepoOptions) {
  const out: string[] = [];
  const err: string[] = [];
  const events: string[] = [];
  const gitFixtures = options.gitFixtures ?? "golden";
  const contents = new Map(Object.entries(options.files).map(([path, text]) => [resolve(REPO_ROOT, path), text]));

  // Every directory that holds a file, with its children in insertion order.
  const children = new Map<string, Map<string, DirEntry["kind"]>>();
  for (const path of contents.keys()) {
    let child = path;
    let kind: DirEntry["kind"] = "file";
    while (child !== "/") {
      const parent = dirname(child);
      const entries = children.get(parent) ?? new Map<string, DirEntry["kind"]>();
      const name = child.slice(parent === "/" ? 1 : parent.length + 1);
      if (!entries.has(name)) entries.set(name, kind);
      children.set(parent, entries);
      child = parent;
      kind = "directory";
    }
  }

  const deps = {
    cwd: options.cwd ?? REPO_ROOT,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        const paths = fixture(`${gitFixtures}/files.txt`).trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
      }
      if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args.includes("diff")) return fixture(`${gitFixtures}/pr.diff`);
      return `${SHA}\n`;
    },
    readFile: async (path: string) => {
      events.push(`read ${path}`);
      return contents.get(path) ?? null;
    },
    listDir: async (path: string): Promise<DirEntry[] | null> => {
      events.push(`list ${path}`);
      const override = options.listings?.[path];
      if (override !== undefined) return override;
      const entries = children.get(path);
      return entries === undefined ? null : [...entries].map(([name, kind]) => ({ name, kind }));
    },
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
      events.push(`stderr ${text}`);
    },
  };
  return {
    deps,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    events,
    reads: () => events.filter((event) => event.startsWith("read ")).map((event) => event.slice("read ".length)),
    lists: () => events.filter((event) => event.startsWith("list ")),
    formatLines: () =>
      err
        .join("")
        .split("\n")
        .filter((line) => line.startsWith("coverage: ")),
  };
}

async function runCli(argv: string[], options: RepoOptions) {
  const { main } = await import("../src/main.js");
  const repo = fakeRepo(options);
  const code = await main(argv, repo.deps as never);
  return { code, ...repo };
}

type Report = {
  verdict: string;
  diffCoverage: {
    coveredLines: number;
    coverableLines: number;
    files: { path: string; coveredLines: number; coverableLines: number }[];
  } | null;
  messages: { level: string; code: string; text: string }[];
};

const measured = (report: Report) =>
  report.diffCoverage?.files.map(({ path, coveredLines, coverableLines }) => ({ path, coveredLines, coverableLines }));

const MONOREPO_MEASURED = [
  { path: "packages/a/src/index.ts", coveredLines: 1, coverableLines: 2 },
  { path: "packages/b/src/index.ts", coveredLines: 2, coverableLines: 2 },
];

describe("pharn-ci check: several coverage files and globs", () => {
  it("AC-11: a repeated --coverage reads both files, merges them and logs one format line per file in order", async () => {
    const { EXIT_OK } = await import("../src/main.js");
    const run = await runCli(["check", "--coverage", "a.info", "--coverage", "b.info", "--format", "json"], {
      files: {
        "a.info": fixture("golden-multi/coverage-a.info"),
        "b.info": fixture("golden-multi/coverage-b.info"),
      },
    });
    expect(run.code).toBe(EXIT_OK);
    const report: Report = JSON.parse(run.stdout());
    // src/math.ts line 3 is covered only in a.info and line 4 only in b.info; src/new.ts is only in b.info.
    expect(measured(report)).toEqual([
      { path: "src/math.ts", coveredLines: 3, coverableLines: 4 },
      { path: "src/new.ts", coveredLines: 1, coverableLines: 2 },
      { path: "src/utils/new-name.ts", coveredLines: 1, coverableLines: 1 },
    ]);
    expect(report.diffCoverage).toMatchObject({ coveredLines: 5, coverableLines: 7 });

    expect(run.formatLines()).toEqual(["coverage: lcov (auto-detected)", "coverage: lcov (auto-detected)"]);
    const coverageReads = run.reads().filter((path) => path.endsWith(".info"));
    expect(coverageReads).toEqual([resolve(REPO_ROOT, "a.info"), resolve(REPO_ROOT, "b.info")]);
    // The first format line is logged after a.info is read.
    const readA = run.events.indexOf(`read ${resolve(REPO_ROOT, "a.info")}`);
    const firstLine = run.events.findIndex((event) => event.startsWith("stderr ") && event.includes("coverage: "));
    expect(readA).toBeGreaterThanOrEqual(0);
    expect(firstLine).toBeGreaterThan(readA);
  });

  it("AC-12: a flag glob resolves against the current directory and a config glob against the repo root", async () => {
    const { EXIT_OK } = await import("../src/main.js");
    const files = {
      "packages/a/coverage/lcov.info": fixture("coverage-multi/monorepo/packages/a/coverage/lcov.info"),
      "packages/b/coverage/lcov.info": fixture("coverage-multi/monorepo/packages/b/coverage/lcov.info"),
    };
    const gitFixtures = "coverage-multi/monorepo";
    const argv = ["check", "--format", "json"];
    const bothRead = [
      resolve(REPO_ROOT, "packages/a/coverage/lcov.info"),
      resolve(REPO_ROOT, "packages/b/coverage/lcov.info"),
    ];
    const coverageReads = (run: { reads: () => string[] }) => run.reads().filter((path) => path.endsWith("lcov.info"));

    const fromFlag = await runCli([...argv, "--coverage", "packages/*/coverage/lcov.info"], { files, gitFixtures });
    expect(fromFlag.code, "flag from the root").toBe(EXIT_OK);
    expect(coverageReads(fromFlag), "flag from the root").toEqual(bothRead);
    const flagReport: Report = JSON.parse(fromFlag.stdout());
    expect(measured(flagReport), "flag from the root").toEqual(MONOREPO_MEASURED);

    const fromConfig = await runCli(argv, {
      files: { ...files, ".pharn/ci.yml": 'coverage:\n  file: ["packages/*/coverage/lcov.info"]\n' },
      gitFixtures,
      cwd: resolve(REPO_ROOT, "packages"),
    });
    expect(fromConfig.code, "config from packages").toBe(EXIT_OK);
    expect(coverageReads(fromConfig), "config from packages").toEqual(bothRead);
    expect(JSON.parse(fromConfig.stdout()), "config from packages").toEqual(flagReport);

    const fromSubdir = await runCli([...argv, "--coverage", "*/coverage/lcov.info"], {
      files,
      gitFixtures,
      cwd: resolve(REPO_ROOT, "packages"),
    });
    expect(fromSubdir.code, "flag from packages").toBe(EXIT_OK);
    expect(coverageReads(fromSubdir), "flag from packages").toEqual(bothRead);
    expect(measured(JSON.parse(fromSubdir.stdout())), "flag from packages").toEqual(MONOREPO_MEASURED);
  });

  it("AC-13: a rejected --coverage pattern exits 2 before any coverage file is read, naming --coverage and the pattern", async () => {
    const { EXIT_ERROR } = await import("../src/main.js");
    for (const pattern of ["../*.info", "/tmp/*.info", "{a,b}.info", "[ab].info", "cov\\*.info", "!*.info"]) {
      const run = await runCli(["check", "--coverage", pattern, "--format", "json"], {
        files: { "a.info": fixture("golden/coverage.info"), "b.info": fixture("golden/coverage.info") },
      });
      expect(run.code, pattern).toBe(EXIT_ERROR);
      const stderr = run.stderr();
      expect(stderr, pattern).toContain("--coverage");
      const escaped = JSON.stringify(pattern).slice(1, -1);
      expect(stderr.includes(pattern) || stderr.includes(escaped), `stderr names ${pattern}`).toBe(true);
      expect(
        run.reads().filter((path) => !path.endsWith("/.pharn/ci.yml")),
        `${pattern}: no coverage file read`,
      ).toEqual([]);
      expect(run.lists(), `${pattern}: no directory listed`).toEqual([]);
      expect(run.formatLines(), pattern).toEqual([]);
    }
  });

  it("AC-14: a glob that matches nothing is COVERAGE_FILE_MISSING naming the glob, and exits 1 with threshold 80", async () => {
    const { EXIT_FAIL } = await import("../src/main.js");
    const glob = "TestResults/**/coverage.cobertura.xml";
    const argv = ["check", "--coverage", glob, "--threshold", "80", "--format", "json"];
    for (const [label, files] of [
      ["no TestResults directory", { "src/other.txt": "x\n" }],
      [
        "TestResults without a matching file",
        {
          "TestResults/6f1c2b9e-3d4a-4c8e-9b7f-0a1e2d3c4b5a/coverage.opencover.xml": "<x/>\n",
          "TestResults/readme.txt": "x\n",
        },
      ],
    ] as const) {
      const run = await runCli(argv, { files });
      expect(run.code, label).toBe(EXIT_FAIL);
      const report: Report = JSON.parse(run.stdout());
      expect(report.diffCoverage, label).toBeNull();
      const missing = report.messages.filter((message) => message.code === "COVERAGE_FILE_MISSING");
      expect(missing, label).toHaveLength(1);
      expect(missing[0]?.level, label).toBe("error");
      expect(missing[0]?.text, label).toContain(glob);
      // The entry is a glob, expanded by walking the tree: it is never opened as a file path, and no file that does
      // not match it is read.
      expect(
        run.reads().filter((path) => path.includes("*")),
        `${label}: the glob is not read as a file`,
      ).toEqual([]);
      expect(
        run.reads().filter((path) => !path.endsWith("/.pharn/ci.yml")),
        `${label}: nothing read`,
      ).toEqual([]);
    }
  });

  it("AC-16: a glob's matches are read in path order, so the first bad file named is the one under a/", async () => {
    const { EXIT_FAIL } = await import("../src/main.js");
    const run = await runCli(["check", "--coverage", "*/lcov.info", "--threshold", "80", "--format", "json"], {
      // Listed b before a, so only sorting puts a/ first.
      files: { "b/lcov.info": "", "a/lcov.info": "" },
    });
    expect(run.code).toBe(EXIT_FAIL);
    const report: Report = JSON.parse(run.stdout());
    const empty = report.messages.filter((message) => message.code === "COVERAGE_FILE_EMPTY");
    expect(empty).toHaveLength(1);
    expect(empty[0]?.text).toContain(resolve(REPO_ROOT, "a/lcov.info"));
    expect(empty[0]?.text).not.toContain("b/lcov.info");
  });

  it("AC-17: more than 1,000 matched files or 100,000 visited entries exits 2; exactly 1,000 files does not", async () => {
    const { EXIT_ERROR } = await import("../src/main.js");
    const covDir = resolve(REPO_ROOT, "cov");
    const name = (index: number) => `f${String(index).padStart(6, "0")}.info`;
    const filesOf = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`cov/${name(index)}`, ""]));
    const argv = ["check", "--coverage", "cov/*.info", "--format", "json"];

    const over = await runCli(argv, { files: filesOf(1001) });
    expect(over.code, "1,001 files").toBe(EXIT_ERROR);
    expect(over.stderr(), "1,001 files: the limit").toMatch(/1,?000/);
    expect(over.stderr(), "1,001 files: the input").toContain("--coverage");

    const atLimit = await runCli(argv, { files: filesOf(1000) });
    expect(atLimit.code, "1,000 files").not.toBe(EXIT_ERROR);
    expect(
      atLimit.reads().filter((path) => path.endsWith(".info")),
      "1,000 files read",
    ).toHaveLength(1000);

    // One directory listing 100,001 entries, none of which match.
    const many: DirEntry[] = Array.from({ length: 100_001 }, (_, index) => ({
      name: `x${String(index).padStart(6, "0")}.txt`,
      kind: "file",
    }));
    const walk = await runCli(argv, { files: { "cov/placeholder.txt": "" }, listings: { [covDir]: many } });
    expect(walk.code, "100,001 entries").toBe(EXIT_ERROR);
    expect(walk.stderr(), "100,001 entries: the walk limit").toMatch(/walk limit/i);
    expect(walk.stderr(), "100,001 entries: exceeded").toMatch(/exceeded/i);
  });
});
