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

describe("parseCobertura: path resolution with many sources (F-24)", () => {
  it("F-24: joins a plain filename to every source but one starting with .. only to the first 16", async () => {
    const map = await parse(fixture("cobertura/many-sources.xml"), ROOT);
    expect(toObject(map)).toEqual({
      "src/pkg/a.py": { 1: 1 },
      "../lib/b.py": { 2: 1 },
    });
    expect(map.has("lib/b.py")).toBe(false);
  });

  // The resolver before F-24: every relative filename joined to every distinct source in order. The parser must give
  // the same keys whenever a report lists at most 16 distinct sources, and for every filename that does not start
  // with `..` however many it lists.
  async function referenceResolve(filename: string, sources: readonly string[], repoRoot: string | undefined) {
    const { isAbsolutePath, normalizePath } = await import("../src/paths.js");
    const climbs = (path: string) => path === ".." || path.startsWith("../");
    if (isAbsolutePath(filename)) return normalizePath(filename, repoRoot);
    for (const source of sources) {
      const joined = `${source}/${filename}`;
      if (isAbsolutePath(source)) {
        if (repoRoot === undefined) continue;
        const key = normalizePath(joined, repoRoot);
        if (!isAbsolutePath(key) && !climbs(key)) return key;
      } else {
        const key = normalizePath(joined);
        if (key !== "" && !climbs(key)) return key;
      }
    }
    return normalizePath(filename, repoRoot);
  }

  const EDGE_SOURCES = [
    "/opt/build",
    "/home/runner/work/demo/demo/../demo/src",
    "/home/runner",
    "/home/runner/work/dem",
    "/home/runner/work/demo/demo2",
    "/HOME/runner/work/demo/demo",
    "/home/runner/work/demo",
    "/home/runner/work/demo/demo",
    "/home/runner/work/demo/demo/",
    "/home/runner/work/demo/demo/C:",
    "/home/runner/work/demo/demo/C:/y",
    "\\home\\runner\\work\\demo\\demo\\lib",
    "/home/runner/work/demo/demo/src",
    "/",
    "C:/",
    "C:\\",
    "c:\\a",
    "C:\\a\\dem",
    "C:\\A\\DEMO",
    "C:\\a\\demo",
    "c:/A/Demo/DEMO",
    "C:\\a\\demo\\demo",
    "C:\\a\\demo\\demo\\C:",
    "C:\\a\\demo\\demo\\c:\\x",
    "C:/a/demo/demo/\u0130",
    "C:/A/DEMO/DEMO/\u212a",
    "C:/i\u0307",
    "C:/\u0130",
    "C:\\a\\demo\\demo\\src",
    "../outside",
    "..",
    "a/..",
    ".",
    "./",
    "C:",
    "./C:/x",
    "./src",
    "src",
  ];
  const EDGE_FILENAMES = [
    "a.py",
    "src/a.py",
    "./b.py",
    ".",
    "x/..",
    "a\\b.py",
    "Demo/m.py",
    "demo/h.py",
    "dem/l.py",
    "work/demo/demo/g.py",
    "runner/work/demo/demo/i.py",
    "o/demo/demo/j.py",
    "a/demo/demo/n.py",
    "demo/q.py",
    "./C:/k.py",
    "C:",
    "../c.py",
    "../../d.py",
    "../demo/e.py",
    "../../../../../../home/runner/work/demo/demo/f.py",
    "../../../a/demo/demo/o.py",
    "..",
    "C:/abs.py",
    "/home/runner/work/demo/demo/p.py",
  ];
  const EDGE_ROOTS = [
    undefined,
    ROOT,
    `${ROOT}/`,
    WINDOWS_ROOT,
    "c:/A/demo/demo",
    "C:\\\u0130\\demo",
    "C:\\",
    "C:/",
    "/",
    "",
  ];

  function report(sources: readonly string[], filenames: readonly string[]): string {
    const sourceXml = sources.map((source) => `<source>${source}</source>`).join("");
    const classXml = filenames
      .map((name, index) => `<class filename="${name}"><lines><line number="${index + 1}" hits="1"/></lines></class>`)
      .join("");
    return `<coverage><sources>${sourceXml}</sources><packages><package><classes>${classXml}</classes></package></packages></coverage>`;
  }

  async function expectSameAsReference(sources: readonly string[], filenames: readonly string[], root?: string) {
    const expected: Record<string, Record<number, number>> = {};
    for (const [index, name] of filenames.entries()) {
      const key = await referenceResolve(name, [...new Set(sources)], root);
      expected[key] = { ...expected[key], [index + 1]: 1 };
    }
    const label = `root ${JSON.stringify(root)}, sources ${JSON.stringify(sources)}`;
    expect(toObject(await parse(report(sources, filenames), root)), label).toEqual(expected);
  }

  it("F-24: resolves every edge-case filename as before for any 16 sources in either order", async () => {
    for (const root of EDGE_ROOTS) {
      for (const list of [EDGE_SOURCES, [...EDGE_SOURCES].reverse()]) {
        for (let start = 0; start + 16 <= list.length; start++) {
          await expectSameAsReference(list.slice(start, start + 16), EDGE_FILENAMES, root);
        }
      }
    }
  }, 60_000);

  it("F-24: resolves every filename not starting with .. as before however many sources there are", async () => {
    const { normalizePath } = await import("../src/paths.js");
    const plain = EDGE_FILENAMES.filter((name) => {
      const path = normalizePath(name);
      return path !== ".." && !path.startsWith("../");
    });
    expect(EDGE_SOURCES.length).toBeGreaterThan(16);
    for (const root of EDGE_ROOTS) {
      for (const list of [EDGE_SOURCES, [...EDGE_SOURCES].reverse()]) {
        for (let start = 0; start < list.length; start++) {
          await expectSameAsReference([...list.slice(start), ...list.slice(0, start)], plain, root);
        }
      }
    }
  }, 60_000);
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
