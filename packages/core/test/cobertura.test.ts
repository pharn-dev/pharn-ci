import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";

// The parser modules are imported inside each test body, never at the top of the file: the AC tests are written
// before the parser exists, and a top-level import of a missing or throwing module would stop the file from loading.
// Fixtures are read inside each body for the same reason.

const ROOT = "/home/runner/work/demo/demo";
const WINDOWS_ROOT = "C:\\a\\demo\\demo";

type CoverageMap = Map<string, Map<number, number>>;

const toObject = (map: CoverageMap) =>
  Object.fromEntries([...map].map(([path, hits]) => [path, Object.fromEntries(hits)]));

async function parse(text: string, repoRoot?: string): Promise<CoverageMap> {
  const { parseCobertura } = await import("../src/coverage/cobertura.js");
  return parseCobertura(text, repoRoot === undefined ? {} : { repoRoot });
}

describe("parseCobertura: realistic reports", () => {
  it("AC-1: reads a coverage.py report whose absolute source lies under the repo root", async () => {
    expect(toObject(await parse(fixture("cobertura/coveragepy.xml"), ROOT))).toEqual({
      "src/app.py": { 1: 1, 2: 1, 4: 0, 5: 1 },
      "src/pkg/util.py": { 1: 1, 3: 0, 4: 2 },
    });
  });

  it("AC-2: reads a pytest-cov report written from the repo root", async () => {
    expect(toObject(await parse(fixture("cobertura/pytest-cov.xml"), ROOT))).toEqual({
      "mypkg/__init__.py": { 1: 1 },
      "mypkg/core.py": { 1: 1, 2: 1, 5: 0, 6: 0, 9: 3 },
    });
  });

  it("AC-3: merges one source file across JaCoCo outer and inner classes by maximum hits", async () => {
    const map = await parse(fixture("cobertura/jacoco.xml"), ROOT);
    expect(toObject(map)).toEqual({
      "src/main/java/com/example/Calculator.java": { 3: 1, 5: 4, 6: 2, 10: 0, 12: 1 },
      "src/main/java/com/example/util/Strings.java": { 3: 0, 4: 0 },
    });
    expect([...map.keys()].filter((key) => key.endsWith("Calculator.java"))).toHaveLength(1);
  });

  it("AC-4: reads a coverlet report with Windows paths into forward-slash repo-relative keys", async () => {
    expect(toObject(await parse(fixture("cobertura/coverlet.xml"), WINDOWS_ROOT))).toEqual({
      "src/Demo/Calculator.cs": { 8: 3, 9: 3, 12: 0 },
      "src/Shared/Guard.cs": { 3: 1, 4: 2 },
    });
  });
});

describe("parseCobertura: XML surface variation", () => {
  it("AC-5: returns the same map for every surface form and ignores markup inside comments and CDATA", async () => {
    const expected = { "src/a.py": { 1: 1, 2: 0, 3: 5 }, "src/b.py": { 1: 0 } };
    const forms = ["forms-base.xml", "forms-variant.xml", "forms-decorated.xml"];
    for (const name of forms) {
      const text = fixture(`cobertura/${name}`);
      const variants = {
        plain: text,
        bom: `\uFEFF${text}`,
        crlf: text.replace(/\r?\n/g, "\r\n"),
        bomCrlf: `\uFEFF${text.replace(/\r?\n/g, "\r\n")}`,
      };
      for (const [variant, input] of Object.entries(variants)) {
        const map = await parse(input, ROOT);
        expect(toObject(map), `${name} (${variant})`).toEqual(expected);
        expect(map.has("src/evil.py"), `${name} (${variant})`).toBe(false);
        expect(map.get("src/a.py")?.has(4), `${name} (${variant})`).toBe(false);
        expect(map.get("src/a.py")?.has(5), `${name} (${variant})`).toBe(false);
      }
    }
  });

  it("AC-6: decodes the &amp; entity in a class filename into a literal &", async () => {
    const map = await parse(fixture("cobertura/entities.xml"), ROOT);
    expect(toObject(map)).toEqual({
      "src/R&D/x.py": { 1: 1 },
      "src/App.py": { 2: 1 },
    });
    expect([...map.keys()].some((key) => key.includes("&amp;"))).toBe(false);
  });
});

describe("parseCobertura: line records", () => {
  it("AC-7: reads a line without hits as 0 hits and skips non-numeric number or hits", async () => {
    const map = await parse(fixture("cobertura/invalid-lines.xml"), ROOT);
    expect(toObject(map)).toEqual({ "src/a.py": { 1: 0, 4: 2 } });
  });

  it("AC-8: ignores method-only lines and reads a branch line's hits", async () => {
    const map = await parse(fixture("cobertura/methods-branches.xml"), ROOT);
    expect(toObject(map)).toEqual({ "src/a.py": { 1: 1, 2: 0 } });
    expect(map.get("src/a.py")?.has(7)).toBe(false);
  });
});

describe("parseCobertura: path resolution", () => {
  it("AC-9: relativizes an absolute filename under the root and keeps one outside it absolute, normalized", async () => {
    expect(toObject(await parse(fixture("cobertura/absolute-filenames.xml"), ROOT))).toEqual({
      "src/a.py": { 1: 1 },
      "/opt/elsewhere/b.py": { 2: 0 },
    });
  });

  it("AC-10: builds the key from the first source whose join lies under the repo root", async () => {
    expect(toObject(await parse(fixture("cobertura/multi-source.xml"), ROOT))).toEqual({
      "pkg/mod/a.py": { 1: 1 },
    });
  });

  it("AC-11: uses the normalized filename as written when there are no sources or none lies under the root", async () => {
    const noSources = fixture("cobertura/no-sources.xml");
    const expectedNoSources = { "src/win/a.cs": { 1: 1 }, "lib/b.py": { 2: 1 } };
    expect(toObject(await parse(noSources, ROOT))).toEqual(expectedNoSources);
    expect(toObject(await parse(noSources))).toEqual(expectedNoSources);

    expect(toObject(await parse(fixture("cobertura/sources-outside.xml"), ROOT))).toEqual({
      "src/x.py": { 3: 2 },
    });
  });

  it("AC-12: never chooses a source join that climbs above the repo root", async () => {
    const map = await parse(fixture("cobertura/climb.xml"), ROOT);
    expect(toObject(map)).toEqual({
      "src/a.py": { 2: 1 },
      "../../escape.py": { 1: 1 },
    });
    const keys = [...map.keys()];
    expect(keys.some((key) => key.startsWith("../outside"))).toBe(false);
    expect(keys).not.toContain("/home/runner/work/demo/escape.py");
  });
});

describe("parseCobertura: empty and malformed reports", () => {
  it("AC-13: returns an empty map for empty, garbage and line-less reports, and keeps only valid classes", async () => {
    expect((await parse("", ROOT)).size).toBe(0);
    expect((await parse(fixture("cobertura/empty.xml"), ROOT)).size).toBe(0);
    expect((await parse(fixture("cobertura/garbage.xml"), ROOT)).size).toBe(0);
    expect((await parse(fixture("cobertura/no-lines.xml"), ROOT)).size).toBe(0);
    expect(toObject(await parse(fixture("cobertura/partial-valid.xml"), ROOT))).toEqual({
      "src/good.py": { 1: 1 },
    });
  });
});

describe("parseCoverage: cobertura dispatch", () => {
  it("AC-15: returns the same map as parseCobertura for every Cobertura fixture", async () => {
    const { parseCobertura } = await import("../src/coverage/cobertura.js");
    const { parseCoverage } = await import("../src/coverage/index.js");
    const files = readdirSync(`${FIXTURES}cobertura`)
      .filter((name) => name.endsWith(".xml"))
      .sort();
    expect(files).toEqual(
      expect.arrayContaining([
        "absolute-filenames.xml",
        "climb.xml",
        "coveragepy.xml",
        "coverlet.xml",
        "empty.xml",
        "entities.xml",
        "forms-base.xml",
        "forms-decorated.xml",
        "forms-variant.xml",
        "garbage.xml",
        "invalid-lines.xml",
        "jacoco.xml",
        "methods-branches.xml",
        "multi-source.xml",
        "no-lines.xml",
        "no-sources.xml",
        "partial-valid.xml",
        "pytest-cov.xml",
        "sources-outside.xml",
      ]),
    );
    for (const name of files) {
      const text = fixture(`cobertura/${name}`);
      for (const options of [{}, { repoRoot: ROOT }, { repoRoot: WINDOWS_ROOT }]) {
        const label = `${name} ${JSON.stringify(options)}`;
        expect(toObject(parseCoverage(text, "cobertura", options)), label).toEqual(
          toObject(parseCobertura(text, options)),
        );
      }
    }
  });
});
