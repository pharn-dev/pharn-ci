import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseCoverageFormat, coverageChoiceLine, type DirEntry, parseCoverage } from "../../core/src/index.js";

// The shared coverage-reading function is imported inside each test body: these tests are written before
// `@pharn-ci/node-io` exists, so nothing that depends on it may run while the file loads. The file deps are an
// in-memory file system keyed by absolute path, filled from the fixtures under `fixtures/`.

const fixture = (path: string) => readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8");

const BASE = "/ws";
const REPO_ROOT = "/home/runner/work/demo/demo";

const LCOV = fixture("lcov/relative.info");
const COBERTURA_A = fixture("cobertura/coveragepy.xml");
const COBERTURA_B = fixture("cobertura/pytest-cov.xml");

/** Absolute path → file text. Directories are derived from the file paths. */
const FILES: Record<string, string> = {
  "/ws/coverage/lcov.info": LCOV,
  "/ws/reports/a/coverage.xml": COBERTURA_A,
  "/ws/reports/b/coverage.xml": COBERTURA_B,
};

/** A fake file system over `FILES` that counts every read per absolute path. */
function fakeDeps(options: { stream: boolean }) {
  const reads = new Map<string, number>();
  const listed: string[] = [];
  const count = (path: string) => reads.set(path, (reads.get(path) ?? 0) + 1);

  const listDir = async (path: string): Promise<DirEntry[] | null> => {
    listed.push(path);
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const entries = new Map<string, DirEntry["kind"]>();
    for (const file of Object.keys(FILES)) {
      if (!file.startsWith(prefix)) continue;
      const [first, ...rest] = file.slice(prefix.length).split("/");
      if (first === undefined) continue;
      entries.set(first, rest.length === 0 ? "file" : "directory");
    }
    if (entries.size === 0) return null;
    return [...entries].map(([name, kind]) => ({ name, kind }));
  };

  const readFile = async (path: string): Promise<string | null> => {
    count(path);
    return FILES[path] ?? null;
  };

  const readFileStream = async (path: string): Promise<AsyncIterable<string> | null> => {
    count(path);
    const text = FILES[path];
    if (text === undefined) return null;
    return (async function* () {
      // Small chunks, so the format is decided over several of them.
      for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
    })();
  };

  const resolvePath = (...segments: string[]) => posix.resolve(...segments);

  const deps = options.stream ? { listDir, readFile, readFileStream, resolvePath } : { listDir, readFile, resolvePath };
  return { deps, reads, listed };
}

/** What the function should return for a file found at `entry` (base-relative), computed from core alone. */
function expectedParsed(text: string, name: string) {
  const choice = chooseCoverageFormat(text, "auto");
  if (choice.format === "empty" || choice.format === "unknown") throw new Error(`fixture ${name} is not coverage`);
  return {
    entry: { parsed: parseCoverage(text, choice.format, { repoRoot: REPO_ROOT }), format: choice.format, file: name },
    line: coverageChoiceLine(choice),
  };
}

const ENTRIES = [
  "coverage/lcov.info", // a literal path
  "reports/*/coverage.xml", // a glob with two matches
  "missing/**/*.info", // a glob with no match
  "nope/lcov.info", // a missing literal path
  "./coverage/lcov.info", // the first file, reached a second time
] as const;

const name = (entry: string) => `named:${entry}`;

describe("@pharn-ci/node-io readCoverageFiles", () => {
  for (const stream of [true, false]) {
    it(`AC-1: reads literal, matched, unmatched, missing and duplicate entries${stream ? "" : " without a file stream"}`, async () => {
      const { readCoverageFiles } = await import("../src/index.js");
      const { deps, reads, listed } = fakeDeps({ stream });
      const logged: string[] = [];

      const files = await readCoverageFiles(deps, {
        entries: ENTRIES,
        label: "coverage-file",
        baseDir: BASE,
        format: "auto",
        repoRoot: REPO_ROOT,
        name,
        log: (line: string) => logged.push(line),
      });

      const lcov = expectedParsed(LCOV, name("coverage/lcov.info"));
      const a = expectedParsed(COBERTURA_A, name("reports/a/coverage.xml"));
      const b = expectedParsed(COBERTURA_B, name("reports/b/coverage.xml"));
      expect(lcov.entry.format).toBe("lcov");
      expect(a.entry.format).toBe("cobertura");
      expect(b.entry.format).toBe("cobertura");
      expect(lcov.entry.parsed.size).toBeGreaterThan(0);
      expect(a.entry.parsed.size).toBeGreaterThan(0);

      // One parsed entry per file found, in entry order; a missingFile for the no-match glob and the missing
      // literal; nothing for the duplicate. Every name comes from the injected naming function.
      expect(files).toEqual([
        lcov.entry,
        a.entry,
        b.entry,
        { missingFile: name("missing/**/*.info") },
        { missingFile: name("nope/lcov.info") },
      ]);

      // The duplicate file was read once, and every file found was read exactly once.
      expect(reads.get("/ws/coverage/lcov.info")).toBe(1);
      expect(reads.get("/ws/reports/a/coverage.xml")).toBe(1);
      expect(reads.get("/ws/reports/b/coverage.xml")).toBe(1);

      // The globs were walked through the injected listDir, on paths resolved against the base directory.
      expect(listed).toContain("/ws/reports");
      expect(listed.every((path) => path.startsWith(BASE))).toBe(true);

      // The logger was called once per file read, with coverageChoiceLine's text for that file.
      expect(logged).toEqual([lcov.line, a.line, b.line]);
    });
  }

  it("AC-1: a configured format is taken as given and logged as configured, with a single-string entry", async () => {
    const { readCoverageFiles } = await import("../src/index.js");
    const { deps, reads } = fakeDeps({ stream: true });
    const logged: string[] = [];

    const files = await readCoverageFiles(deps, {
      entries: "coverage/lcov.info",
      label: "coverage-file",
      baseDir: BASE,
      format: "lcov",
      repoRoot: REPO_ROOT,
      name,
      log: (line: string) => logged.push(line),
    });

    expect(files).toEqual([
      {
        parsed: parseCoverage(LCOV, "lcov", { repoRoot: REPO_ROOT }),
        format: "lcov",
        file: name("coverage/lcov.info"),
      },
    ]);
    expect(reads.get("/ws/coverage/lcov.info")).toBe(1);
    expect(logged).toEqual([coverageChoiceLine({ format: "lcov", how: "configured" })]);
  });
});
