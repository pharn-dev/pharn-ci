import { describe, expect, it } from "vitest";

// The matcher and the pattern validation are imported inside each test body, from the package's public
// entry point: these tests are written before the matcher exists, so nothing that depends on it may run
// while the file loads.

type Match = (pattern: string, path: string) => boolean;

async function loadMatchGlob(): Promise<Match> {
  const core = await import("../src/index.js");
  return (core as unknown as { matchGlob: Match }).matchGlob;
}

describe("matchGlob", () => {
  it("AC-1: matches the glob subset anchored at the root, case-sensitively, and everything else literally", async () => {
    const matchGlob = await loadMatchGlob();
    const table: [pattern: string, matches: string[], rejects: string[]][] = [
      ["*.ts", ["a.ts", ".ts"], ["src/a.ts"]],
      ["src/*.ts", ["src/a.ts"], ["src/x/a.ts"]],
      ["src/**", ["src", "src/a.ts", "src/x/y/a.ts"], ["srcx/a.ts"]],
      ["**/test/**", ["test/a.ts", "a/b/test/c.ts"], ["a/testing/c.ts"]],
      ["**/*.gen.ts", ["a.gen.ts", "x/y/a.gen.ts"], ["a.gen.tsx"]],
      ["a?c.ts", ["abc.ts"], ["ac.ts", "a/c.ts"]],
      ["**", ["a", "x/y/z.ts"], []],
      ["a**b.ts", ["axyb.ts"], ["ax/yb.ts"]],
      ["*.TS", [], ["a.ts"]],
      ["a.ts", [], ["abts"]],
    ];
    for (const [pattern, matches, rejects] of table) {
      for (const path of matches) expect(matchGlob(pattern, path), `${pattern} ~ ${path}`).toBe(true);
      for (const path of rejects) expect(matchGlob(pattern, path), `${pattern} !~ ${path}`).toBe(false);
    }

    // A pattern made of characters the subset does not treat specially matches only itself.
    const literal = "a+(b)|$.ts";
    expect(matchGlob(literal, literal)).toBe(true);
    const everyPath = table.flatMap(([, matches, rejects]) => [...matches, ...rejects]);
    for (const path of everyPath) expect(matchGlob(literal, path), `${literal} !~ ${path}`).toBe(false);
  });

  it("AC-2: accepts ./src/** as src/** and rejects unsupported patterns with a ConfigError naming them", async () => {
    const core = (await import("../src/index.js")) as unknown as {
      parseExcludePattern: (pattern: string, label?: string) => string;
    };
    const { ConfigError } = await import("../src/config.js");
    const matchGlob = await loadMatchGlob();
    const { parseExcludePattern } = core;

    const accepted = parseExcludePattern("./src/**");
    for (const path of ["src", "src/a.ts", "src/x/y/a.ts", "srcx/a.ts", "a/src/b.ts", "./src/a.ts", "README.md"]) {
      expect(matchGlob(accepted, path), path).toBe(matchGlob("src/**", path));
    }

    const rejected = [
      "",
      "./",
      "/src/**",
      "!src/**",
      "src/",
      "a//b",
      "../x",
      "a/../b",
      "src\\gen\\*.ts",
      "{a,b}.ts",
      "[ab].ts",
      "a]b",
    ];
    for (const pattern of rejected) {
      let error: unknown;
      try {
        parseExcludePattern(pattern);
      } catch (e) {
        error = e;
      }
      expect(error, JSON.stringify(pattern)).toBeInstanceOf(ConfigError);
      expect((error as Error).message, JSON.stringify(pattern)).toContain(pattern);
    }
  });

  it("AC-3: matches paths a pull request can name as given, without normalizing or throwing", async () => {
    const matchGlob = await loadMatchGlob();
    expect(matchGlob("src/**", "src/../secret.ts")).toBe(true);
    expect(matchGlob("*.ts", "./a.ts")).toBe(false);
    expect(matchGlob("**/a.ts", "./a.ts")).toBe(true);
    expect(matchGlob("src/*.ts", "src\\a.ts")).toBe(false);
    expect(matchGlob("*.ts", "src\\a.ts")).toBe(true);
    expect(matchGlob("?.ts", "é.ts")).toBe(true);
    expect(matchGlob("?.ts", "😀.ts")).toBe(true);
    expect(matchGlob("docs/*", "docs/ünï.md")).toBe(true);
  });

  it("AC-4: matches 100,000-character paths in linear time", async () => {
    const matchGlob = await loadMatchGlob();
    const timed = (pattern: string, path: string, expected: boolean) => {
      const start = performance.now();
      const result = matchGlob(pattern, path);
      const elapsed = performance.now() - start;
      expect(result, `${pattern} on ${path.length} characters`).toBe(expected);
      expect(elapsed, `${pattern} on ${path.length} characters`).toBeLessThan(1000);
    };

    const segment = "a".repeat(100_000);
    timed("*a*a*a*a*a*a*a*a*b", segment, false);
    timed("*a*a*a*a*a*a*a*a*b", `${segment}b`, true);

    const segments = `${"ab/".repeat(34_000)}c`;
    expect(segments.length).toBeGreaterThanOrEqual(100_000);
    timed("**/*/**/*/**/*/**/*.x", segments, false);
    timed("**/*/**/*/**/*/**/*.x", `${segments}.x`, true);
  });
});
